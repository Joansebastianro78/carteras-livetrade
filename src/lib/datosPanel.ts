/**
 * Lo que el Asistente IA puede consultar del panel. SOLO SERVIDOR.
 *
 * Son consultas fijas y de solo lectura, una por pregunta típica de cada
 * módulo («cómo va la auditoría», «cuántos puntos se asignaron hoy»…). La IA
 * no escribe SQL ni toca la base: elige una de estas consultas y sus
 * parámetros (fechas, un nombre), y aquí se validan y se ejecutan.
 *
 * Cada consulta pide los mismos módulos que la pantalla de donde salen sus
 * datos (src/lib/permisos.ts): el asistente de un perfil sin «Auditoría de
 * datos» no puede consultar la auditoría de datos.
 */
import { supabaseAdmin } from "./supabaseAdmin";
import { SUPERADMIN, type IdModulo } from "./permisos";
import { esColumnaFaltante, esTablaFaltante, textoError } from "./tablaFaltante";
import { leerResumenCartera, filtroLibres } from "./resumenCartera";
import { leerActividad } from "./actividad";
import { estadoConsulta, explicarError, iniciarConsulta, paginaResultados, type PaginaResultados } from "./athena";
import { SQL_AUDITORIA } from "./consultaAuditoria";
import { SQL_IMAGENES } from "./consultaImagenes";
import { filasDesdeAthena } from "./auditoria";
import { claveHallazgo } from "./revisionHallazgos";
import { filasDeImagenes } from "./imagenesAuditoria";
import { limpiarTexto } from "./limpiadorAuditoria";
import { textoHasta } from "./mantenimiento";

// ------------------------------------------------------------------ tipos

/** Esquema JSON de los parámetros, en el subconjunto que entienden Groq y Gemini. */
type Esquema = {
  type: "object";
  properties: Record<string, { type: "string" | "integer"; description: string }>;
  required?: string[];
};

export type PermisosPanel = { usuario: string; rol: string; modulos: readonly IdModulo[] };

type Contexto = PermisosPanel & {
  signal: AbortSignal;
  /** Para contar en la pantalla qué se está haciendo («Corriendo la consulta en Athena…»). */
  avisar: (texto: string) => void;
};

export type ConsultaPanel = {
  /** Nombre de la función para la IA (letras, números y guion bajo). */
  nombre: string;
  /** Cómo se llama en la pantalla. */
  titulo: string;
  /** Para la IA: qué trae y cuándo usarla. */
  descripcion: string;
  parametros: Esquema;
  /** Basta con tener uno de estos módulos. */
  modulos: IdModulo[];
  ejecutar: (args: Record<string, unknown>, ctx: Contexto) => Promise<unknown>;
};

/** Un error que se le explica a la IA tal cual (no es una falla del servidor). */
class AvisoConsulta extends Error {}

// ------------------------------------------------------------------ fechas

const ZONA = "America/Bogota";
const formatoDia = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" });
const formatoHora = new Intl.DateTimeFormat("es-CO", { timeZone: ZONA, hour: "numeric", minute: "2-digit" });
const formatoMomento = new Intl.DateTimeFormat("es-CO", {
  timeZone: ZONA,
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
});

/** 'AAAA-MM-DD' de un momento, en hora de Colombia. */
export const diaBogota = (fecha: Date) => formatoDia.format(fecha);

/** 'AAAA-MM-DD' en Colombia de un momento guardado; vacío si no se entiende. */
function diaDeIso(iso: unknown): string {
  const f = new Date(String(iso ?? ""));
  return Number.isNaN(f.getTime()) ? "" : diaBogota(f);
}

/** Suma días a 'AAAA-MM-DD' (Colombia no cambia de hora: no hay saltos). */
export function sumarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** El primer instante de ese día en Colombia (UTC-5), en ISO. */
const inicioDelDia = (dia: string) => `${dia}T05:00:00.000Z`;

/** «martes, 13 de octubre, 4:31 p. m.» */
function momentoLegible(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const f = new Date(iso);
  return Number.isNaN(f.getTime()) ? null : formatoMomento.format(f);
}

const ES_DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * El rango de fechas que pidió la IA. Sin fechas: `porDefecto` (hoy, o todo
 * si es null). Hasta 366 días.
 */
function rangoDe(args: Record<string, unknown>, porDefecto: "hoy" | null): { desde: string; hasta: string } | null {
  const hoy = diaBogota(new Date());
  let desde = typeof args.desde === "string" && ES_DIA.test(args.desde) ? args.desde : null;
  let hasta = typeof args.hasta === "string" && ES_DIA.test(args.hasta) ? args.hasta : null;
  if (!desde && !hasta) {
    if (porDefecto === null) return null;
    desde = hasta = hoy;
  }
  desde ??= hasta!;
  hasta ??= desde > hoy ? desde : hoy;
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  if (sumarDias(desde, 366) < hasta) desde = sumarDias(hasta, -366);
  return { desde, hasta };
}

const enRango = (dia: string | null, r: { desde: string; hasta: string } | null) =>
  !r || (dia !== null && dia >= r.desde && dia <= r.hasta);

const PARAMS_RANGO = {
  desde: { type: "string" as const, description: "Primer día, AAAA-MM-DD (hora de Colombia)." },
  hasta: { type: "string" as const, description: "Último día, AAAA-MM-DD (incluido)." },
};

// ------------------------------------------------------------------ ayudas

const esLibre = (usuario: unknown, ccuser: unknown) => usuario === "LIBRE" || ccuser === "LIBRE";

/** Los n más grandes de un conteo, de mayor a menor. */
function top<T extends Record<string, unknown>>(lista: T[], campo: keyof T, n: number): T[] {
  return [...lista].sort((a, b) => Number(b[campo]) - Number(a[campo])).slice(0, n);
}

function contar<K>(mapa: Map<K, number>, clave: K, n = 1) {
  mapa.set(clave, (mapa.get(clave) ?? 0) + n);
}

/** Lee una tabla o vista completa, de a 1000 filas, hasta `tope`. */
async function leerTodo(
  armar: (desde: number, hasta: number) => PromiseLike<{ data: unknown[] | null; error: { message?: string; code?: string } | null; status: number }>,
  tope: number
): Promise<{ filas: Record<string, unknown>[]; recortado: boolean; error: { message?: string; code?: string } | null; status: number }> {
  const filas: Record<string, unknown>[] = [];
  for (let desde = 0; desde < tope; desde += 1000) {
    const { data, error, status } = await armar(desde, desde + 999);
    if (error) return { filas, recortado: false, error, status };
    filas.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < 1000) return { filas, recortado: false, error: null, status };
  }
  return { filas, recortado: true, error: null, status: 200 };
}

function fallaBase(donde: string, error: { message?: string; code?: string }, status: number, sinTabla: string): never {
  console.error(`[asistente datos ${donde}]`, textoError(error, status));
  throw new AvisoConsulta(esTablaFaltante(error, status) ? sinTabla : "No se pudo leer la base de datos.");
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Corre una de las consultas fijas de Athena y trae todas sus filas. */
async function correrAthena(sql: string, ctx: Contexto) {
  let id: string;
  try {
    id = await iniciarConsulta(sql, false);
  } catch (e) {
    console.error("[asistente athena inicio]", (e as Error)?.message);
    throw new AvisoConsulta(explicarError(e));
  }
  ctx.avisar("Corriendo la consulta en Athena…");
  const limite = Date.now() + 110_000;
  let enviada: string | null = null;
  let reutilizada = false;
  for (;;) {
    if (ctx.signal.aborted) throw new AvisoConsulta("Se canceló.");
    const estado = await estadoConsulta(id).catch((e) => {
      console.error("[asistente athena estado]", (e as Error)?.message);
      throw new AvisoConsulta(explicarError(e));
    });
    enviada = estado.enviada;
    reutilizada = estado.reutilizada;
    if (estado.estado === "SUCCEEDED") break;
    if (estado.estado === "FAILED" || estado.estado === "CANCELLED") {
      throw new AvisoConsulta(`La consulta de Athena falló: ${estado.motivo ?? "sin motivo"}.`);
    }
    if (Date.now() > limite) throw new AvisoConsulta("Athena se demoró más de dos minutos. Intenta de nuevo en un rato.");
    await esperar(1500);
  }
  let columnas: string[] = [];
  const filas: (string | null)[][] = [];
  let token: string | null = null;
  for (let pagina = 0; pagina < 80; pagina++) {
    if (ctx.signal.aborted) throw new AvisoConsulta("Se canceló.");
    const p: PaginaResultados = await paginaResultados(id, token).catch((e) => {
      console.error("[asistente athena pagina]", (e as Error)?.message);
      throw new AvisoConsulta(explicarError(e));
    });
    columnas = p.columnas;
    filas.push(...p.filas);
    token = p.siguiente;
    if (!token) break;
  }
  return { columnas, filas, enviada, reutilizada, completa: token === null };
}

// ------------------------------------------------------------------ consultas

const SIN_TABLA_REVISADOS = "Falta la tabla de hallazgos revisados (supabase/hallazgos.sql).";
const SIN_TABLA_FOTOS = "Falta la tabla de revisión de fotos (supabase/panel.sql).";

const CONSULTAS: ConsultaPanel[] = [
  // -------------------------------------------------------- cartera
  {
    nombre: "cartera_resumen",
    titulo: "Cartera",
    descripcion:
      "Cómo está la cartera ahora: ciclo actual; en toda la cartera, puntos, asignados a un consultor, LIBRE (sin consultor), consultores con puntos y puntos sin coordenadas; cifras por ciclo y por departamento; las dos últimas cargas de Excel y si la página de consulta de los consultores está abierta.",
    parametros: { type: "object", properties: {} },
    modulos: ["inicio", "cargar"],
    async ejecutar() {
      const r = await leerResumenCartera();
      const carga = (c: typeof r.ultimaCarga) =>
        c && {
          archivo: c.archivo,
          modo: c.modo,
          filas_cargadas: c.filas_ok,
          filas_del_archivo: c.filas,
          observaciones: c.filas_error,
          cargado_por: c.cargado_por,
          cuando: momentoLegible(c.created_at),
        };
      return {
        ciclo_actual: r.ciclo,
        toda_la_cartera: r.general,
        ciclo_actual_detalle: r.actual && {
          puntos: r.actual.puntos,
          consultores: r.actual.consultores,
          libres: r.libres,
          sin_coordenadas: r.actual.sin_ubicacion,
          ultima_actualizacion: momentoLegible(r.actual.ultima_actualizacion),
        },
        por_ciclo: r.ciclos.slice(0, 8).map((c) => ({
          ciclo: c.ciclo,
          puntos: c.puntos,
          sin_coordenadas: c.sin_ubicacion,
          ultima_actualizacion: momentoLegible(c.ultima_actualizacion),
        })),
        por_departamento: r.departamentos?.slice(0, 15) ?? null,
        ultima_carga: carga(r.ultimaCarga),
        carga_anterior: carga(r.cargaAnterior),
        pagina_de_consulta: r.mantenimiento.activo
          ? `cerrada por mantenimiento${r.mantenimiento.hasta ? ` (${textoHasta(r.mantenimiento.hasta)})` : ""}`
          : "abierta",
        aviso: r.errorCiclos,
      };
    },
  },
  {
    nombre: "cartera_asignaciones",
    titulo: "Asignaciones de puntos",
    descripcion:
      "Puntos asignados o cambiados en un rango de días: puntos nuevos (y cuántos con consultor y cuántos LIBRE), puntos que ya existían y se actualizaron (reasignaciones, correcciones o cargas), por consultor, por ciclo y por archivo, las cargas de Excel de esos días y las ediciones a mano. Para «cuántos puntos se asignaron hoy, ayer o esta semana». Sin fechas: hoy.",
    parametros: { type: "object", properties: PARAMS_RANGO },
    modulos: ["inicio", "cargar", "editar"],
    async ejecutar(args) {
      const rango = rangoDe(args, "hoy")!;
      const a = inicioDelDia(rango.desde);
      const b = inicioDelDia(sumarDias(rango.hasta, 1));
      const puntos = () => supabaseAdmin.from("puntos_cartera").select("id_registro", { count: "exact", head: true });

      const [nuevos, nuevosLibres, actualizados, filas, cargas, cambios] = await Promise.all([
        puntos().gte("created_at", a).lt("created_at", b),
        filtroLibres(puntos().gte("created_at", a).lt("created_at", b)),
        puntos().gte("updated_at", a).lt("updated_at", b).lt("created_at", a),
        leerTodo(
          (d, h) =>
            supabaseAdmin
              .from("puntos_cartera")
              .select("usuario,nom,ccuser,ciclo,archivo_origen,created_at")
              .or(`and(created_at.gte.${a},created_at.lt.${b}),and(updated_at.gte.${a},updated_at.lt.${b})`)
              .order("id_registro", { ascending: true })
              .range(d, h),
          30_000
        ),
        supabaseAdmin
          .from("cargas_cartera")
          .select("*")
          .gte("created_at", a)
          .lt("created_at", b)
          .order("created_at", { ascending: false })
          .limit(30),
        supabaseAdmin.from("auditoria_cartera").select("accion").gte("created_at", a).lt("created_at", b).limit(5000),
      ]);
      for (const [donde, r] of [["nuevos", nuevos], ["libres", nuevosLibres], ["actualizados", actualizados]] as const) {
        if (r.error) fallaBase(`asignaciones ${donde}`, r.error, r.status, "No se pudo leer la cartera.");
      }
      if (filas.error) fallaBase("asignaciones filas", filas.error, filas.status, "No se pudo leer la cartera.");

      const porConsultor = new Map<string, { usuario: string; nombre: string | null; nuevos: number; actualizados: number }>();
      const porCiclo = new Map<string, { ciclo: string; nuevos: number; actualizados: number }>();
      const porArchivo = new Map<string, { archivo: string; nuevos: number; actualizados: number }>();
      for (const f of filas.filas) {
        const nuevo = String(f.created_at ?? "") >= a;
        const campo = nuevo ? "nuevos" : "actualizados";
        const ciclo = String(f.ciclo ?? "") || "(sin ciclo)";
        const c = porCiclo.get(ciclo) ?? { ciclo, nuevos: 0, actualizados: 0 };
        c[campo]++;
        porCiclo.set(ciclo, c);
        const archivo = String(f.archivo_origen ?? "") || "(sin archivo)";
        const ar = porArchivo.get(archivo) ?? { archivo, nuevos: 0, actualizados: 0 };
        ar[campo]++;
        porArchivo.set(archivo, ar);
        if (esLibre(f.usuario, f.ccuser)) continue;
        const clave = `${f.usuario}␟${f.ccuser}`;
        const p = porConsultor.get(clave) ?? { usuario: String(f.usuario), nombre: (f.nom as string | null) ?? null, nuevos: 0, actualizados: 0 };
        p[campo]++;
        porConsultor.set(clave, p);
      }
      const total = (x: { nuevos: number; actualizados: number }) => x.nuevos + x.actualizados;
      const accionesManuales = new Map<string, number>();
      for (const c of cambios.data ?? []) contar(accionesManuales, String(c.accion));

      return {
        rango,
        puntos_nuevos: {
          total: nuevos.count ?? 0,
          con_consultor: Math.max(0, (nuevos.count ?? 0) - (nuevosLibres.count ?? 0)),
          libres: nuevosLibres.count ?? 0,
        },
        puntos_que_ya_existian_y_se_actualizaron: actualizados.count ?? 0,
        consultores_con_puntos_nuevos_o_actualizados: porConsultor.size,
        por_consultor: [...porConsultor.values()].sort((x, y) => total(y) - total(x)).slice(0, 20),
        por_ciclo: [...porCiclo.values()].sort((x, y) => total(y) - total(x)).slice(0, 10),
        por_archivo: [...porArchivo.values()].sort((x, y) => total(y) - total(x)).slice(0, 10),
        cargas_de_excel: cargas.error
          ? null
          : (cargas.data ?? []).map((c) => ({
              archivo: c.archivo,
              modo: c.modo ?? null,
              filas_cargadas: c.filas_ok,
              observaciones: c.filas_error ?? 0,
              cargado_por: c.cargado_por ?? null,
              cuando: momentoLegible(c.created_at),
            })),
        ediciones_a_mano: cambios.error ? null : Object.fromEntries(accionesManuales),
        nota:
          (filas.recortado ? "El desglose por consultor, ciclo y archivo cuenta solo los primeros 30.000 puntos. " : "") +
          "«Actualizados» es cualquier cambio de un punto que ya existía (reasignación, corrección o una carga que lo reescribió); la base no guarda cuál campo cambió.",
      };
    },
  },
  {
    nombre: "actividad_reciente",
    titulo: "Actividad del panel",
    descripcion:
      "Lo último que se hizo en el panel, con quién y cuándo: cargas de Excel, ediciones y borrados de puntos, hallazgos revisados, queries de fotos, cambios de usuarios, perfiles, tableros, temas y mantenimiento.",
    parametros: {
      type: "object",
      properties: { limite: { type: "integer", description: "Cuántos movimientos traer (1 a 30). Por defecto 15." } },
    },
    modulos: ["inicio"],
    async ejecutar(args) {
      const limite = Math.min(Math.max(Math.round(Number(args.limite)) || 15, 1), 30);
      const { actividad, aviso } = await leerActividad(limite);
      return {
        movimientos: actividad.map((m) => ({
          cuando: momentoLegible(m.momento),
          usuario: m.usuario,
          accion: m.accion,
          detalle: m.detalle ? JSON.stringify(m.detalle).slice(0, 300) : null,
        })),
        aviso,
      };
    },
  },
  // -------------------------------------------------------- auditoría de datos
  {
    nombre: "auditoria_revisados",
    titulo: "Hallazgos revisados",
    descripcion:
      "Hallazgos de la auditoría de datos ya marcados como revisados: cuántos en total, hoy y en los últimos días, quién los revisó, por motivo y por departamento, y cuántos vinieron en carga masiva. Es rápida (no corre la consulta de Athena). Con fechas, cuenta los revisados en esos días.",
    parametros: { type: "object", properties: PARAMS_RANGO },
    modulos: ["auditoria"],
    async ejecutar(args) {
      const rango = rangoDe(args, null);
      const leer = (campos: string) =>
        leerTodo(
          (d, h) =>
            supabaseAdmin
              .from("revision_hallazgos")
              .select(campos)
              .order("revisado_en", { ascending: false })
              .order("clave", { ascending: true })
              .range(d, h) as unknown as PromiseLike<{ data: unknown[] | null; error: { message?: string; code?: string } | null; status: number }>,
          200_000
        );
      let lectura = await leer("motivo,revisado_por,revisado_en,departamento,archivo");
      if (lectura.error && esColumnaFaltante(lectura.error)) lectura = await leer("motivo,revisado_por,revisado_en,departamento");
      if (lectura.error) fallaBase("revisados", lectura.error, lectura.status, SIN_TABLA_REVISADOS);

      const hoy = diaBogota(new Date());
      const semana = sumarDias(hoy, -6);
      const filas = lectura.filas.map((f): Record<string, unknown> & { dia: string } => ({
        ...f,
        dia: diaDeIso(f.revisado_en),
      }));
      const elegidas = filas.filter((f) => enRango(f.dia, rango));
      const porDia = new Map<string, number>();
      const personas = new Map<string, number>();
      const motivos = new Map<string, number>();
      const departamentos = new Map<string, number>();
      let enCarga = 0;
      for (const f of elegidas) {
        contar(porDia, f.dia);
        contar(personas, (f.revisado_por as string) || "Sin usuario");
        contar(motivos, (f.motivo as string) || "Sin motivo");
        contar(departamentos, (f.departamento as string) || "Sin departamento");
        if (f.archivo) enCarga++;
      }
      const lista = (m: Map<string, number>, nombre: string, n: number) =>
        top([...m.entries()].map(([k, v]) => ({ [nombre]: k, revisados: v })), "revisados", n);
      return {
        rango: rango ?? "todo el historial",
        revisados_en_el_rango: elegidas.length,
        total_historico: filas.length,
        hoy: filas.filter((f) => f.dia === hoy).length,
        ultimos_7_dias: filas.filter((f) => f.dia >= semana).length,
        ultimo_revisado: momentoLegible(filas[0]?.revisado_en as string | undefined),
        por_dia: [...porDia.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1)).slice(0, 31).map(([dia, n]) => ({ dia, revisados: n })),
        por_persona: lista(personas, "usuario", 10),
        por_motivo: lista(motivos, "motivo", 10),
        por_departamento: lista(departamentos, "departamento", 10),
        en_carga_masiva: enCarga,
        uno_por_uno: elegidas.length - enCarga,
      };
    },
  },
  {
    nombre: "auditoria_datos_estado",
    titulo: "Auditoría de datos",
    descripcion:
      "Cómo va la auditoría de datos completa: corre la consulta de Athena (puede tardar hasta un minuto; reutiliza un resultado de los últimos minutos) y cruza con lo revisado. Da los hallazgos, cuántos pendientes y cuántos revisados (avance), por motivo, por departamento, por consultor y por día. Con fechas, solo los hallazgos de esos días. Úsala para «cómo va la auditoría», «cuántos hallazgos faltan», «quién tiene más pendientes».",
    parametros: { type: "object", properties: PARAMS_RANGO },
    modulos: ["auditoria"],
    async ejecutar(args, ctx) {
      const rango = rangoDe(args, null);
      const [athena, claves] = await Promise.all([
        correrAthena(SQL_AUDITORIA, ctx),
        leerTodo(
          (d, h) =>
            supabaseAdmin.from("revision_hallazgos").select("clave").order("clave", { ascending: true }).range(d, h),
          500_000
        ),
      ]);
      const revisadas = new Set(claves.error ? [] : claves.filas.map((f) => String(f.clave)));
      const filas = filasDesdeAthena(athena.columnas, athena.filas).filter((f) => enRango(f.dia, rango));

      const motivos = new Map<string, { motivo: string; pendientes: number; revisados: number }>();
      const departamentos = new Map<string, number>();
      const consultores = new Map<string, number>();
      const dias = new Map<string, number>();
      let pendientes = 0;
      for (const f of filas) {
        const revisado = revisadas.has(claveHallazgo(f));
        const m = motivos.get(f.motivo) ?? { motivo: f.motivo, pendientes: 0, revisados: 0 };
        m[revisado ? "revisados" : "pendientes"]++;
        motivos.set(f.motivo, m);
        if (revisado) continue;
        pendientes++;
        contar(departamentos, limpiarTexto(f.departamento) || "Sin departamento");
        contar(consultores, limpiarTexto(f.nombre_usuario) || "Sin consultor");
        contar(dias, f.dia ?? "sin fecha");
      }
      const total = filas.length;
      const lista = (m: Map<string, number>, nombre: string, n: number) =>
        top([...m.entries()].map(([k, v]) => ({ [nombre]: k, pendientes: v })), "pendientes", n);
      return {
        rango: rango ?? "todos los hallazgos de la consulta",
        consultado: momentoLegible(athena.enviada),
        resultado_reutilizado_de_hace_unos_minutos: athena.reutilizada,
        hallazgos: total,
        pendientes,
        revisados: total - pendientes,
        avance_porcentaje: total ? Math.round(((total - pendientes) / total) * 1000) / 10 : null,
        consultores_con_pendientes: consultores.size,
        por_motivo: [...motivos.values()].sort((x, y) => y.pendientes + y.revisados - (x.pendientes + x.revisados)),
        por_departamento: lista(departamentos, "departamento", 10),
        por_consultor: lista(consultores, "consultor", 10),
        pendientes_por_dia: [...dias.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1)).slice(0, 14).map(([dia, n]) => ({ dia, pendientes: n })),
        aviso: [
          claves.error ? "No se pudieron leer los revisados: todo cuenta como pendiente." : null,
          athena.completa ? null : "La consulta tenía demasiadas filas: se contaron las primeras 80.000.",
        ]
          .filter(Boolean)
          .join(" ") || null,
      };
    },
  },
  // -------------------------------------------------------- auditoría de imágenes
  {
    nombre: "auditoria_imagenes_estado",
    titulo: "Auditoría de imágenes",
    descripcion:
      "Cómo va la auditoría de imágenes (fotos de inicio de visita): corre la consulta de Athena (puede tardar hasta un minuto) y cruza con las revisiones. Da visitas, con foto, sin foto, fotos marcadas correctas o para revisar, pendientes de mirar, quién revisó y los consultores con más visitas sin foto o para revisar. Con fechas, solo las visitas de esos días.",
    parametros: { type: "object", properties: PARAMS_RANGO },
    modulos: ["imagenes"],
    async ejecutar(args, ctx) {
      const rango = rangoDe(args, null);
      const [athena, revisiones] = await Promise.all([
        correrAthena(SQL_IMAGENES, ctx),
        leerTodo(
          (d, h) =>
            supabaseAdmin
              .from("revision_fotos")
              .select("clave,estado,revisado_por,updated_at")
              .order("clave", { ascending: true })
              .range(d, h),
          500_000
        ),
      ]);
      if (revisiones.error && !esTablaFaltante(revisiones.error, revisiones.status)) {
        fallaBase("fotos", revisiones.error, revisiones.status, SIN_TABLA_FOTOS);
      }
      const estados = new Map(revisiones.filas.map((r) => [String(r.clave), r]));
      const filas = filasDeImagenes(athena.columnas, athena.filas).filter((f) => enRango(f.dia, rango));

      let conFoto = 0, sinFoto = 0, noEnlace = 0, correctas = 0, paraRevisar = 0;
      const consultores = new Map<string, { consultor: string; visitas: number; sin_foto: number; para_revisar: number; pendientes: number }>();
      const revisores = new Map<string, number>();
      for (const f of filas) {
        const nombre = limpiarTexto(f.nombre_usuario) || "Sin consultor";
        const c = consultores.get(nombre) ?? { consultor: nombre, visitas: 0, sin_foto: 0, para_revisar: 0, pendientes: 0 };
        c.visitas++;
        if (f.estado === "sin_foto") {
          sinFoto++;
          c.sin_foto++;
        } else if (f.estado === "no_es_enlace") {
          noEnlace++;
        } else {
          conFoto++;
          const r = f.clave ? estados.get(f.clave) : undefined;
          if (!r) c.pendientes++;
          else {
            contar(revisores, (r.revisado_por as string) || "Sin usuario");
            if (r.estado === "correcta") correctas++;
            else {
              paraRevisar++;
              c.para_revisar++;
            }
          }
        }
        consultores.set(nombre, c);
      }
      const lista = [...consultores.values()];
      return {
        rango: rango ?? "todas las visitas de la consulta",
        consultado: momentoLegible(athena.enviada),
        visitas: filas.length,
        con_foto: conFoto,
        sin_foto: sinFoto,
        foto_que_no_es_enlace: noEnlace,
        fotos_correctas: correctas,
        fotos_para_revisar: paraRevisar,
        fotos_sin_mirar: conFoto - correctas - paraRevisar,
        revisiones_por_persona: top([...revisores.entries()].map(([usuario, n]) => ({ usuario, fotos: n })), "fotos", 10),
        consultores_con_mas_sin_foto: top(lista.filter((c) => c.sin_foto > 0), "sin_foto", 10),
        consultores_con_mas_para_revisar: top(lista.filter((c) => c.para_revisar > 0), "para_revisar", 10),
        aviso: revisiones.error ? SIN_TABLA_FOTOS : null,
      };
    },
  },
  // -------------------------------------------------------- consultores y territorio
  {
    nombre: "consultores_buscar",
    titulo: "Consultores",
    descripcion:
      "Busca consultores por su usuario (por ejemplo BAV006), su nombre o su cédula, y da su cartera: puntos, ciclos, ciclo más reciente, número de ruta, puntos sin coordenadas y última actualización. Hasta 10 coincidencias.",
    parametros: {
      type: "object",
      properties: { texto: { type: "string", description: "Usuario, parte del nombre o cédula." } },
      required: ["texto"],
    },
    modulos: ["consultores"],
    async ejecutar(args) {
      // Solo letras, números, espacio, punto y guiones: nada que cambie el filtro.
      const texto = String(args.texto ?? "").normalize("NFC").replace(/[^\p{L}\p{N} ._-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
      if (texto.length < 2) throw new AvisoConsulta("Falta el usuario, el nombre o la cédula del consultor.");
      const patron = `%${texto.replace(/ /g, "%")}%`;
      const filtros = [`usuario.ilike.${patron}`, `nom.ilike.${patron}`];
      if (/^\d{5,12}$/.test(texto)) filtros.push(`ccuser.eq.${texto}`);
      const { data, error, status, count } = await supabaseAdmin
        .from("resumen_consultores")
        .select("usuario,nom,num_de_ruta,puntos,ciclos,ciclo_reciente,sin_ubicacion,ultima_actualizacion", { count: "exact" })
        .or(filtros.join(","))
        .limit(10);
      if (error) fallaBase("consultores", error, status, "Falta la vista de consultores (supabase/gestion.sql).");
      return {
        buscado: texto,
        coincidencias: count ?? (data ?? []).length,
        consultores: (data ?? []).map((c) => ({
          usuario: c.usuario,
          nombre: c.nom,
          ruta: c.num_de_ruta,
          puntos: c.puntos,
          ciclos: c.ciclos,
          ciclo_reciente: c.ciclo_reciente,
          sin_coordenadas: c.sin_ubicacion,
          ultima_actualizacion: momentoLegible(c.ultima_actualizacion as string),
        })),
      };
    },
  },
  {
    nombre: "territorio_puntos",
    titulo: "Departamento y ciudad",
    descripcion:
      "Puntos de la cartera por departamento y ciudad. Sin departamento: todos los departamentos con sus puntos. Con departamento: sus ciudades. Se puede limitar a un ciclo.",
    parametros: {
      type: "object",
      properties: {
        departamento: { type: "string", description: "Nombre del departamento (opcional), por ejemplo CUNDINAMARCA." },
        ciclo: { type: "string", description: "Ciclo (opcional), tal como aparece en la cartera." },
      },
    },
    modulos: ["territorio"],
    async ejecutar(args) {
      const plano = (s: unknown) =>
        String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
      const depto = plano(args.departamento).slice(0, 60);
      const ciclo = typeof args.ciclo === "string" ? args.ciclo.trim().slice(0, 40) : "";
      const { filas, error, status, recortado } = await leerTodo((d, h) => {
        let q = supabaseAdmin
          .from("resumen_territorio")
          .select("departamento_clave,ciudad_clave,ciclo,departamento,ciudad,puntos")
          .order("departamento_clave", { ascending: true })
          .order("ciudad_clave", { ascending: true })
          .order("ciclo", { ascending: true });
        if (ciclo) q = q.eq("ciclo", ciclo);
        return q.range(d, h);
      }, 50_000);
      if (error) fallaBase("territorio", error, status, "Falta la vista de territorio (supabase/territorio.sql).");

      const porDepto = new Map<string, number>();
      const ciudades = new Map<string, number>();
      let total = 0;
      for (const f of filas) {
        const n = Number(f.puntos) || 0;
        const nombre = plano(f.departamento) || "SIN DEPARTAMENTO";
        total += n;
        contar(porDepto, nombre, n);
        if (depto && nombre.includes(depto)) contar(ciudades, plano(f.ciudad) || "SIN CIUDAD", n);
      }
      const lista = (m: Map<string, number>, campo: string) =>
        top([...m.entries()].map(([k, v]) => ({ [campo]: k, puntos: v })), "puntos", 40);
      return {
        ciclo: ciclo || "todos",
        puntos: total,
        ...(depto
          ? {
              departamento: depto,
              puntos_del_departamento: [...ciudades.values()].reduce((x, y) => x + y, 0),
              ciudades: lista(ciudades, "ciudad"),
              aviso: ciudades.size === 0 ? `No hay puntos en un departamento que se llame «${depto}».` : null,
            }
          : { departamentos: lista(porDepto, "departamento") }),
        nota: recortado ? "Se leyeron solo las primeras 50.000 combinaciones de ciudad y ciclo." : null,
      };
    },
  },
];

// ------------------------------------------------------------------ uso

/** Las consultas que puede usar ese perfil. */
export function consultasPara(rol: string, modulos: readonly IdModulo[]): ConsultaPanel[] {
  if (rol === SUPERADMIN) return CONSULTAS;
  return CONSULTAS.filter((c) => c.modulos.some((m) => modulos.includes(m)));
}

/** Todas, para la documentación y las pruebas. */
export const TODAS_LAS_CONSULTAS: readonly ConsultaPanel[] = CONSULTAS;

export type ResultadoConsulta =
  | { ok: true; nombre: string; titulo: string; args: Record<string, unknown>; datos: unknown }
  | { ok: false; nombre: string; titulo: string; args: Record<string, unknown>; error: string };

/**
 * Ejecuta una consulta pedida por la IA, si ese perfil la tiene. Nunca
 * lanza: un error vuelve explicado, para que la IA lo cuente.
 */
export async function ejecutarConsulta(
  nombre: string,
  args: Record<string, unknown>,
  ctx: Contexto
): Promise<ResultadoConsulta> {
  const consulta = consultasPara(ctx.rol, ctx.modulos).find((c) => c.nombre === nombre);
  if (!consulta) {
    return { ok: false, nombre, titulo: nombre, args, error: "Esa consulta no existe o el perfil no la tiene." };
  }
  try {
    const datos = await consulta.ejecutar(args, ctx);
    return { ok: true, nombre, titulo: consulta.titulo, args, datos };
  } catch (e) {
    if (!(e instanceof AvisoConsulta)) console.error(`[asistente datos ${nombre}]`, e);
    return {
      ok: false,
      nombre,
      titulo: consulta.titulo,
      args,
      error: e instanceof AvisoConsulta ? e.message : "No se pudo hacer la consulta.",
    };
  }
}

/** El momento de ahora, para encabezar los datos: «martes, 13 de octubre, 4:31 p. m.». */
export function ahoraLegible(): string {
  return formatoMomento.format(new Date());
}

/** «4:31 p. m.» */
export function horaLegible(): string {
  return formatoHora.format(new Date());
}
