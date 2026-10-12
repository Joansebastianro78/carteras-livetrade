import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_ADMIN, leerSesion } from "@/lib/auth";
import { registrarActividad } from "@/lib/actividad";
import { PATRON_CLAVE } from "@/lib/revisionFotos";
import { esColumnaFaltante, esTablaFaltante, textoError } from "@/lib/tablaFaltante";
import type { HallazgoRevisado, ResumenRevisados } from "@/lib/revisionHallazgos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hallazgos revisados de la auditoría de datos (tabla revision_hallazgos, en
 * supabase/hallazgos.sql). Pide el módulo «Auditoría de datos»: quien ve la
 * auditoría puede marcar y ver lo revisado. No cambia nada de la cartera.
 *
 *   GET                      → los revisados, del más reciente al más antiguo
 *   GET ?campos=claves       → solo sus claves, para sacarlos de la lista
 *   GET ?campos=resumen      → cuántos por día y por persona, para el Inicio
 *   POST   { hallazgos: [...] } → los marca como revisados (hasta 500)
 *   DELETE { claves: [...] }    → los devuelve a pendientes (hasta 500)
 *
 * La carga masiva manda en su último lote «carga» (archivo y cuántos), y
 * queda una sola línea en la actividad del panel por carga, no una por lote.
 *
 * Si dos personas marcan el mismo a la vez, queda el primero que lo hizo. El
 * POST responde en «nuevos» las claves que de verdad marcó esta vez, para que
 * la carga masiva pueda deshacer solo lo suyo.
 */

const AVISO_SIN_TABLA =
  "Para marcar hallazgos como revisados falta la tabla revision_hallazgos. Ejecuta supabase/hallazgos.sql en el SQL Editor.";
const AVISO_COLUMNAS =
  "Para la carga masiva hay que actualizar la tabla revision_hallazgos: ejecuta otra vez supabase/hallazgos.sql en el SQL Editor (no borra nada).";
const AVISO_COLUMNAS_LECTURA =
  "Para ver las observaciones de la carga masiva, ejecuta otra vez supabase/hallazgos.sql en el SQL Editor (no borra nada).";

const MAXIMO = 500;
const CAMPOS_BASE =
  "clave,codigo_bavaria,pdv,consultor,departamento,provincia,pregunta,respuesta,motivo,tipo_linea,actividad_id,fecha_hallazgo,revisado_por,revisado_en";
const CAMPOS = `${CAMPOS_BASE},observacion,archivo`;
const ZONA = "America/Bogota";

/** Un conteo que manda el navegador, solo para la actividad. */
function conteo(valor: unknown): number {
  const n = Math.round(Number(valor));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1_000_000) : 0;
}

/** Lo que manda la carga masiva para la actividad; null si no vino. */
function datosCarga(valor: unknown): Record<string, unknown> | null {
  return valor && typeof valor === "object" ? (valor as Record<string, unknown>) : null;
}

/** Recorta un texto opcional antes de guardarlo. */
function texto(valor: unknown, largo: number): string | null {
  if (typeof valor !== "string") return null;
  const t = valor.trim();
  return t ? t.slice(0, largo) : null;
}

type ErrorSupabase = { message?: string; code?: string };

function fallo(error: ErrorSupabase, status: number, donde: string, mensaje: string) {
  console.error(`[revision-hallazgos ${donde}]`, textoError(error, status));
  // Primero la columna: su error también dice «does not exist».
  if (esColumnaFaltante(error)) return NextResponse.json({ error: AVISO_COLUMNAS }, { status: 503 });
  const falta = esTablaFaltante(error, status);
  return NextResponse.json({ error: falta ? AVISO_SIN_TABLA : mensaje }, { status: falta ? 503 : 500 });
}

/** Toda la tabla con esas columnas. Supabase entrega de a 1000 filas por consulta. */
async function leerTodo(campos: string) {
  const filas: Record<string, unknown>[] = [];
  for (let desde = 0; desde < 200_000; desde += 1000) {
    const { data, error, status } = await supabaseAdmin
      .from("revision_hallazgos")
      .select(campos)
      .order("revisado_en", { ascending: false })
      .order("clave", { ascending: true })
      .range(desde, desde + 999);
    if (error) return { filas, error: error as ErrorSupabase, status };
    filas.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  return { filas, error: null, status: 200 };
}

/** 'AAAA-MM-DD' de un momento, en hora de Colombia. */
const diaEnBogota = (() => {
  const formato = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" });
  return (fecha: Date) => formato.format(fecha);
})();

function resumir(filas: Record<string, unknown>[]): ResumenRevisados {
  const ahora = Date.now();
  // Colombia no cambia de hora en el año: restar días de 24 horas es exacto.
  const dias = Array.from({ length: 14 }, (_, i) => diaEnBogota(new Date(ahora - (13 - i) * 86_400_000)));
  const porDia = new Map(dias.map((d) => [d, 0]));
  const semana = new Set(dias.slice(-7));
  const hoy = dias[dias.length - 1];
  const personas = new Map<string, number>();
  let deHoy = 0;
  let deSemana = 0;

  for (const f of filas) {
    const fecha = new Date(String(f.revisado_en ?? ""));
    if (!Number.isNaN(fecha.getTime())) {
      const dia = diaEnBogota(fecha);
      if (porDia.has(dia)) porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
      if (dia === hoy) deHoy++;
      if (semana.has(dia)) deSemana++;
    }
    const quien = typeof f.revisado_por === "string" && f.revisado_por ? f.revisado_por : "Sin usuario";
    personas.set(quien, (personas.get(quien) ?? 0) + 1);
  }

  return {
    total: filas.length,
    hoy: deHoy,
    semana: deSemana,
    dias: dias.map((dia) => ({ dia, n: porDia.get(dia) ?? 0 })),
    personas: [...personas.entries()]
      .map(([usuario, n]) => ({ usuario, n }))
      .sort((a, b) => b.n - a.n || a.usuario.localeCompare(b.usuario, "es"))
      .slice(0, 5),
  };
}

// ------------------------------------------------- leer
export async function GET(req: Request) {
  const campos = new URL(req.url).searchParams.get("campos");

  if (campos === "claves" || campos === "resumen") {
    const { filas, error, status } = await leerTodo(campos === "claves" ? "clave" : "revisado_en,revisado_por");
    if (error) {
      // Sin la tabla, la auditoría se ve como antes: con un aviso y sin revisados.
      if (esTablaFaltante(error, status)) {
        return NextResponse.json(
          campos === "claves" ? { claves: [], aviso: AVISO_SIN_TABLA } : { resumen: null, aviso: AVISO_SIN_TABLA }
        );
      }
      console.error(`[revision-hallazgos GET ${campos}]`, textoError(error, status));
      return NextResponse.json({ error: "No se pudieron leer los hallazgos revisados." }, { status: 500 });
    }
    if (campos === "claves") return NextResponse.json({ claves: filas.map((f) => f.clave), aviso: null });
    return NextResponse.json({ resumen: resumir(filas), aviso: null });
  }

  let lectura = await leerTodo(CAMPOS);
  let aviso: string | null = null;
  // Tabla de antes de la carga masiva: se lee sin las columnas nuevas y se avisa.
  if (lectura.error && esColumnaFaltante(lectura.error)) {
    lectura = await leerTodo(CAMPOS_BASE);
    aviso = AVISO_COLUMNAS_LECTURA;
  }
  const { filas, error, status } = lectura;
  if (error) {
    if (esTablaFaltante(error, status)) return NextResponse.json({ revisados: [], aviso: AVISO_SIN_TABLA });
    console.error("[revision-hallazgos GET]", textoError(error, status));
    return NextResponse.json({ error: "No se pudieron leer los hallazgos revisados." }, { status: 500 });
  }
  return NextResponse.json({ revisados: filas as HallazgoRevisado[], aviso });
}

// ------------------------------------------------- marcar
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { hallazgos?: unknown; carga?: unknown };
  const lista = Array.isArray(body.hallazgos) ? (body.hallazgos as Record<string, unknown>[]) : [];

  if (lista.length === 0) {
    return NextResponse.json({ error: "Falta el hallazgo que se quiere marcar." }, { status: 400 });
  }
  if (lista.length > MAXIMO) {
    return NextResponse.json({ error: `Se pueden marcar hasta ${MAXIMO} a la vez.` }, { status: 400 });
  }
  if (lista.some((h) => typeof h?.clave !== "string" || !PATRON_CLAVE.test(h.clave as string))) {
    return NextResponse.json({ error: "Hay un hallazgo sin clave válida." }, { status: 400 });
  }

  const store = await cookies();
  const sesion = await leerSesion(store.get(COOKIE_ADMIN)?.value, process.env.ADMIN_SECRET);
  const ahora = new Date().toISOString();

  // Las columnas de la carga masiva van solo si vienen: así marcar uno por uno
  // sigue funcionando con una tabla de antes (sin volver a correr el .sql).
  const deCarga = lista.some((h) => "observacion" in h || "archivo" in h);

  // Sin repetir claves: Postgres no deja la misma dos veces en un mismo upsert.
  const unicas = new Map(lista.map((h) => [h.clave as string, h]));
  const filas = [...unicas.values()].map((h) => ({
    clave: h.clave as string,
    codigo_bavaria: texto(h.codigo_bavaria, 60),
    pdv: texto(h.pdv, 200),
    consultor: texto(h.consultor, 120),
    departamento: texto(h.departamento, 120),
    provincia: texto(h.provincia, 120),
    pregunta: texto(h.pregunta, 500),
    respuesta: texto(h.respuesta, 500),
    motivo: texto(h.motivo, 120),
    tipo_linea: texto(h.tipo_linea, 120),
    actividad_id: texto(h.actividad_id, 80),
    fecha_hallazgo: texto(h.fecha_hallazgo, 40),
    revisado_por: sesion?.usuario ?? null,
    revisado_en: ahora,
    ...(deCarga ? { observacion: texto(h.observacion, 300), archivo: texto(h.archivo, 200) } : {}),
  }));

  // Con ignoreDuplicates, lo que devuelve son solo las filas que se insertaron.
  const { data, error, status } = await supabaseAdmin
    .from("revision_hallazgos")
    .upsert(filas, { onConflict: "clave", ignoreDuplicates: true })
    .select("clave");
  if (error) return fallo(error, status, "marcar", "No se pudo marcar como revisado.");

  const carga = datosCarga(body.carga);
  if (carga) {
    await registrarActividad(sesion?.usuario ?? null, "revisados_carga", {
      archivo: texto(carga.archivo, 200),
      hallazgos: conteo(carga.hallazgos),
      pdv: conteo(carga.pdv),
    });
  }

  return NextResponse.json({
    ok: true,
    marcados: filas.length,
    nuevos: (data ?? []).map((f) => f.clave as string),
    revisado_por: sesion?.usuario ?? null,
    revisado_en: ahora,
  });
}

// ------------------------------------------------- devolver a pendientes
export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { claves?: unknown; carga?: unknown };
  const claves = Array.isArray(body.claves) ? body.claves : [];

  if (claves.length === 0 || claves.length > MAXIMO || claves.some((c) => typeof c !== "string" || !PATRON_CLAVE.test(c))) {
    return NextResponse.json({ error: "Faltan los hallazgos que se quieren devolver." }, { status: 400 });
  }

  const { error, status } = await supabaseAdmin
    .from("revision_hallazgos")
    .delete()
    .in("clave", claves as string[]);
  if (error) return fallo(error, status, "devolver", "No se pudo devolver a pendientes.");

  const carga = datosCarga(body.carga);
  if (carga) {
    const store = await cookies();
    const sesion = await leerSesion(store.get(COOKIE_ADMIN)?.value, process.env.ADMIN_SECRET);
    await registrarActividad(sesion?.usuario ?? null, "revisados_deshacer", {
      archivo: texto(carga.archivo, 200),
      hallazgos: conteo(carga.hallazgos),
    });
  }

  return NextResponse.json({ ok: true, devueltos: claves.length });
}
