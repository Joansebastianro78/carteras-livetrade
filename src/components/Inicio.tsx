"use client";

import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  ChevronRight,
  ClipboardCheck,
  FileSpreadsheet,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  TriangleAlert,
  Upload,
  UserX,
  Users,
  Wrench,
} from "lucide-react";
import { MOTIVOS, filasDesdeAthena, type FilaAuditoria } from "@/lib/auditoria";
import { MODULOS, type IdModulo } from "@/lib/permisos";
import { claveHallazgo, leerClavesRevisadas, leerResumenRevisados, type ResumenRevisados } from "@/lib/revisionHallazgos";
import { cuando, diaCorto } from "@/lib/fechas";
import { SUGERENCIAS_INICIO, dejarPregunta } from "@/lib/asistentePendiente";
import { exportarTerritorio } from "@/lib/excel";
import {
  guardarResumenAuditoria,
  leerResumenAuditoria,
  resumirAuditoria,
  type ResumenAuditoria,
} from "@/lib/resumenAuditoria";
import type { PuntoTerritorio } from "@/lib/territorio";
import { ProgresoConsulta, cifra, useConsultaAthena } from "./ConsultaAthena";
import type { Navegacion } from "./PanelShell";

/**
 * Inicio del panel: los puntos asignados, cómo está la cartera hoy, los
 * hallazgos revisados por día, la auditoría por motivo, el asistente, lo
 * último que se hizo, lo que conviene revisar, los departamentos y atajos.
 * Las tarjetas que llevan a otro módulo salen solo si el perfil lo tiene.
 * Al abrirse, las tarjetas entran una tras otra y las barras crecen (sin
 * movimiento para quien lo pidió en su sistema).
 */

type Carga = {
  archivo: string;
  modo: string | null;
  filas: number;
  filas_ok: number;
  filas_error: number;
  detalle: { fila: number; motivo: string }[];
  cargado_por: string | null;
  created_at: string;
};

type Resumen = {
  ciclo: string | null;
  ciclos: { ciclo: string; puntos: number; consultores: number; sin_ubicacion: number }[];
  mantenimiento: { activo: boolean; hasta: string | null };
  errorCiclos: string | null;
  actual: { ciclo: string; puntos: number; consultores: number; sin_ubicacion: number } | null;
  /** Toda la cartera, todos los ciclos. null: no se pudo contar. */
  general: {
    puntos: number;
    sin_ubicacion: number;
    asignados: number | null;
    libres: number | null;
    consultores: number | null;
  };
  libres: number | null;
  ultimaCarga: Carga | null;
  departamentos: { nombre: string; puntos: number }[] | null;
};

type ItemActividad = {
  momento: string;
  usuario: string | null;
  accion: string;
  detalle: Record<string, unknown> | null;
};

/** Cómo se llama cada campo editable cuando se cuenta qué cambió. */
const CAMPO: Record<string, string> = {
  pdv: "nombre",
  direccion: "dirección",
  persona_hacku: "contacto",
  celular: "celular",
  que_hacer: "tarea",
  ruta: "ruta",
  num_de_ruta: "ruta del consultor",
  usuario: "usuario",
  ccuser: "cédula",
  nom: "nombre del consultor",
  persona: "persona",
  latitud: "coordenadas",
  longitud: "coordenadas",
};

const PERFIL: Record<string, string> = {
  superadmin: "superadministrador",
  admin: "administrador",
  backoffice: "BackOffice",
};

/** El nombre del perfil: el que quedó guardado con la acción, o el de siempre. */
function nombrePerfil(clave: string, guardado: unknown): string {
  return typeof guardado === "string" && guardado ? guardado : (PERFIL[clave] ?? clave);
}

/** "Inicio, Consultores y 2 más". */
function nombresModulos(ids: unknown): string {
  if (!Array.isArray(ids) || ids.length === 0) return "";
  const nombres = ids.map((id) => MODULOS.find((m) => m.id === id)?.nombre ?? String(id));
  return nombres.length <= 3
    ? nombres.join(", ")
    : `${nombres.slice(0, 2).join(", ")} y ${nombres.length - 2} más`;
}

/** Lo que pasó, en una frase, y un detalle debajo. */
function describir(a: ItemActividad): { frase: string; detalle: string | null } {
  const d = a.detalle ?? {};
  const txt = (k: string) => (d[k] === undefined || d[k] === null ? "" : String(d[k]));
  switch (a.accion) {
    case "cargar":
      return {
        frase:
          d.modo === "actualizar"
            ? "actualizó la cartera con un archivo"
            : d.modo === "agregar"
              ? "agregó puntos nuevos"
              : "cargó la plantilla completa",
        detalle: `${txt("archivo")} · ${cifra(Number(d.filas) || 0)} filas`,
      };
    case "editar": {
      const campos = [
        ...new Set(
          Object.keys(d)
            .filter((k) => k !== "id_pdv" && k !== "ciclo")
            .map((k) => CAMPO[k] ?? k.replace(/_/g, " "))
        ),
      ];
      return {
        frase: `editó el punto ${txt("id_pdv")}`,
        detalle: campos.length ? `Cambió ${campos.slice(0, 4).join(", ")}` : null,
      };
    }
    case "eliminar":
      return { frase: `eliminó el punto ${txt("id_pdv")}`, detalle: txt("pdv") || null };
    case "purgar":
      return {
        frase: `eliminó ${txt("alcance") || "puntos de la cartera"}`,
        detalle: `${cifra(Number(d.eliminados) || 0)} puntos`,
      };
    case "mantenimiento_abrir":
      return { frase: "puso la consulta en mantenimiento", detalle: txt("mensaje") || null };
    case "mantenimiento_cerrar":
      return { frase: "abrió de nuevo la consulta", detalle: null };
    case "usuario_crear":
      return {
        frase: `creó el usuario ${txt("usuario")}`,
        detalle: `Perfil ${nombrePerfil(txt("rol"), d.perfil)}`,
      };
    case "usuario_clave":
      return { frase: `cambió la clave de ${txt("usuario")}`, detalle: null };
    case "usuario_rol":
      return {
        frase: `cambió el perfil de ${txt("usuario")}`,
        detalle: `De ${nombrePerfil(txt("antes"), d.perfilAntes)} a ${nombrePerfil(txt("ahora"), d.perfilAhora)}`,
      };
    case "usuario_activar":
      return { frase: `reactivó a ${txt("usuario")}`, detalle: null };
    case "usuario_desactivar":
      return { frase: `desactivó a ${txt("usuario")}`, detalle: null };
    case "tablero_agregar":
      return { frase: `agregó el tablero «${txt("nombre")}»`, detalle: null };
    case "tablero_editar":
      return { frase: `editó el tablero «${txt("nombre")}»`, detalle: null };
    case "tablero_publicar":
      return { frase: `publicó el tablero «${txt("nombre")}»`, detalle: null };
    case "tablero_ocultar":
      return { frase: `ocultó el tablero «${txt("nombre")}»`, detalle: null };
    case "tablero_eliminar":
      return { frase: `eliminó el tablero «${txt("nombre")}»`, detalle: null };
    case "tema_cambiar":
      return { frase: "cambió los temas de temporada", detalle: txt("descripcion") || null };
    case "perfil_crear": {
      const n = Array.isArray(d.modulos) ? d.modulos.length : 0;
      return {
        frase: `creó el perfil «${txt("nombre")}»`,
        detalle: n === 0 ? "Sin módulos" : `${n} ${n === 1 ? "módulo" : "módulos"}: ${nombresModulos(d.modulos)}`,
      };
    }
    case "perfil_editar": {
      const partes = [
        nombresModulos(d.agregados) && `Puede ver ${nombresModulos(d.agregados)}`,
        nombresModulos(d.quitados) && `ya no ve ${nombresModulos(d.quitados)}`,
      ].filter(Boolean);
      const frase = partes.length
        ? `cambió los permisos del perfil «${txt("nombre")}»`
        : `editó el perfil «${txt("nombre")}»`;
      const detalle = partes.join("; ");
      return { frase, detalle: detalle ? detalle.charAt(0).toUpperCase() + detalle.slice(1) : null };
    }
    case "perfil_eliminar":
      return { frase: `eliminó el perfil «${txt("nombre")}»`, detalle: null };
    case "revisados_carga": {
      const n = Number(d.hallazgos) || 0;
      const pdv = Number(d.pdv) || 0;
      return {
        frase: `marcó ${n === 1 ? "1 hallazgo" : `${cifra(n)} hallazgos`} como revisados con una carga masiva`,
        detalle: [txt("archivo"), pdv ? `${cifra(pdv)} PDV` : ""].filter(Boolean).join(" · ") || null,
      };
    }
    case "revisados_deshacer": {
      const n = Number(d.hallazgos) || 0;
      return {
        frase: "deshizo una carga masiva de revisados",
        detalle: [txt("archivo"), `${n === 1 ? "1 hallazgo volvió" : `${cifra(n)} hallazgos volvieron`} a pendientes`]
          .filter(Boolean)
          .join(" · "),
      };
    }
    case "query_fotos_crear":
      return { frase: `guardó la query de fotos «${txt("nombre")}»`, detalle: null };
    case "query_fotos_editar":
      return {
        frase: `editó la query de fotos «${txt("nombre")}»`,
        detalle: d.anterior && d.anterior !== d.nombre ? `Antes se llamaba «${txt("anterior")}»` : null,
      };
    case "query_fotos_eliminar":
      return { frase: `borró la query de fotos «${txt("nombre")}»`, detalle: null };
    default:
      return { frase: a.accion.replace(/_/g, " "), detalle: null };
  }
}

/** "Viernes, 9 de octubre". */
function hoyEnPalabras(): string {
  const t = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Bogota",
  }).format(new Date());
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "Buenos días", "Buenas tardes" o "Buenas noches", en hora de Colombia. */
function saludoDeAhora(): string {
  const h = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", hour: "numeric", hourCycle: "h23" }).format(new Date())
  );
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

export default function Inicio({ nav }: { nav: Navegacion }) {
  const { irA, puede } = nav;
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [errorResumen, setErrorResumen] = useState<string | null>(null);
  const [actividad, setActividad] = useState<ItemActividad[] | null>(null);
  const [avisoActividad, setAvisoActividad] = useState<string | null>(null);
  const [auditoria, setAuditoria] = useState<ResumenAuditoria | null>(null);
  const [verObservaciones, setVerObservaciones] = useState(false);
  const [bajando, setBajando] = useState<string | null>(null);
  const [hoy, setHoy] = useState("");
  const [saludo, setSaludo] = useState("Hola");

  // La auditoría no corre sola aquí: consultar Athena en cada visita al Inicio
  // sería lento y costaría. Se muestra lo último que se vio y se puede pedir.
  const consulta = useConsultaAthena<FilaAuditoria>("/api/admin/auditoria", filasDesdeAthena, {
    automatica: false,
  });

  useEffect(() => {
    setHoy(hoyEnPalabras());
    setSaludo(saludoDeAhora());
    setAuditoria(leerResumenAuditoria());

    fetch("/api/admin/resumen")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? "No se pudo leer el resumen.");
        setResumen(j as Resumen);
      })
      .catch((e) => setErrorResumen((e as Error).message));

    fetch("/api/admin/actividad?limite=7")
      .then((r) => (r.ok ? r.json() : { actividad: [] }))
      .then((j) => {
        setActividad(j.actividad ?? []);
        setAvisoActividad(j.aviso ?? null);
      })
      .catch(() => setActividad([]));
  }, []);

  // El resumen cuenta solo lo que falta revisar, igual que la auditoría.
  useEffect(() => {
    if (consulta.fase.tipo !== "listo") return;
    let vivo = true;
    leerClavesRevisadas().then(({ claves }) => {
      if (!vivo) return;
      const pendientes = claves.size ? consulta.filas.filter((f) => !claves.has(claveHallazgo(f))) : consulta.filas;
      const revisadas = claves.size ? consulta.filas.filter((f) => claves.has(claveHallazgo(f))) : [];
      const r = resumirAuditoria(pendientes, consulta.info?.enviada ?? null, revisadas);
      guardarResumenAuditoria(r);
      setAuditoria(r);
    });
    return () => {
      vivo = false;
    };
  }, [consulta.fase.tipo, consulta.filas, consulta.info]);

  async function descargarLista(tipo: "sin-ubicacion" | "libres") {
    setBajando(tipo);
    try {
      const r = await fetch(`/api/admin/resumen?lista=${tipo}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      exportarTerritorio(j.puntos as PuntoTerritorio[], [
        tipo === "libres" ? "sin_consultor" : "sin_coordenadas",
        "toda_la_cartera",
      ]);
    } catch {
      setErrorResumen("No se pudo armar el Excel. Intenta de nuevo.");
    } finally {
      setBajando(null);
    }
  }

  const general = resumen?.general ?? null;
  const ultima = resumen?.ultimaCarga ?? null;
  const deptos = resumen?.departamentos ?? null;
  const maxDepto = deptos?.[0]?.puntos ?? 1;

  const pendientes: {
    id: string;
    tono: "alerta" | "aviso" | "neutro";
    Icono: typeof MapPin;
    titulo: string;
    detalle: string;
    accion: React.ReactNode;
  }[] = [];

  if (resumen?.mantenimiento.activo) {
    pendientes.push({
      id: "mantenimiento",
      tono: "aviso",
      Icono: Wrench,
      titulo: "La consulta está en mantenimiento",
      detalle: "Los consultores ven el aviso y no pueden consultar su cartera.",
      accion: puede("mantenimiento") && (
        <a href="#mantenimiento" className="text-[13px] font-medium whitespace-nowrap underline underline-offset-2">
          Revisar
        </a>
      ),
    });
  }
  if (general && general.sin_ubicacion > 0) {
    pendientes.push({
      id: "sin-ubicacion",
      tono: "alerta",
      Icono: MapPin,
      titulo: `${cifra(general.sin_ubicacion)} ${general.sin_ubicacion === 1 ? "punto" : "puntos"} sin coordenadas`,
      detalle: "No aparecen en el mapa del consultor.",
      accion: (
        <button
          type="button"
          onClick={() => descargarLista("sin-ubicacion")}
          disabled={bajando !== null}
          className="text-[13px] font-medium whitespace-nowrap underline underline-offset-2 disabled:opacity-50"
        >
          {bajando === "sin-ubicacion" ? "Armando…" : "Descargar"}
        </button>
      ),
    });
  }
  if (ultima && ultima.filas_error > 0) {
    pendientes.push({
      id: "observaciones",
      tono: "aviso",
      Icono: FileSpreadsheet,
      titulo: `${cifra(ultima.filas_error)} ${ultima.filas_error === 1 ? "fila" : "filas"} con observaciones en el último cargue`,
      detalle: ultima.archivo,
      accion: ultima.detalle.length > 0 && (
        <button
          type="button"
          aria-expanded={verObservaciones}
          onClick={() => setVerObservaciones((v) => !v)}
          className="text-[13px] font-medium whitespace-nowrap underline underline-offset-2"
        >
          {verObservaciones ? "Ocultar" : "Ver"}
        </button>
      ),
    });
  }
  if (general?.libres) {
    pendientes.push({
      id: "libres",
      tono: "neutro",
      Icono: UserX,
      titulo: `${cifra(general.libres)} ${general.libres === 1 ? "punto" : "puntos"} sin consultor (LIBRE)`,
      detalle: "En toda la cartera.",
      accion: (
        <button
          type="button"
          onClick={() => descargarLista("libres")}
          disabled={bajando !== null}
          className="text-[13px] font-medium whitespace-nowrap underline underline-offset-2 disabled:opacity-50"
        >
          {bajando === "libres" ? "Armando…" : "Descargar"}
        </button>
      ),
    });
  }

  const atajos = (
    [
      { id: "editar", Icono: Search, titulo: "Buscar un punto", detalle: "Por código, PDV o dirección" },
      { id: "consultores", Icono: Users, titulo: "Cartera de un consultor", detalle: "Mapa, puntos y descargas" },
      { id: "territorio", Icono: MapPin, titulo: "Puntos por departamento", detalle: "Filtrar y bajar en Excel" },
      { id: "auditoria", Icono: ClipboardCheck, titulo: "Auditoría de datos", detalle: "Hallazgos y Excel limpio" },
    ] satisfies { id: IdModulo; Icono: typeof MapPin; titulo: string; detalle: string }[]
  ).filter((a) => puede(a.id));

  // ------------------------------------------------------------ revisados (barras finas)
  const veAuditoria = puede("auditoria");
  const [revisadosResumen, setRevisadosResumen] = useState<ResumenRevisados | null>(null);
  const [avisoRevisados, setAvisoRevisados] = useState<string | null>(null);

  useEffect(() => {
    if (!veAuditoria) return;
    let vivo = true;
    leerResumenRevisados().then(({ resumen, aviso }) => {
      if (!vivo) return;
      setRevisadosResumen(resumen);
      setAvisoRevisados(aviso ?? (resumen ? null : "No se pudo leer el resumen de revisados."));
    });
    return () => {
      vivo = false;
    };
  }, [veAuditoria]);

  // ------------------------------------------------------------ asistente
  const [pregunta, setPregunta] = useState("");

  function preguntar(texto: string, enviar: boolean) {
    dejarPregunta({ texto, enviar });
    irA("asistente");
  }

  // ------------------------------------------------------------ derivados
  const revisadosConsulta = auditoria?.revisados ?? 0;
  const totalConsulta = auditoria ? auditoria.total + revisadosConsulta : 0;
  const avance = auditoria?.revisados !== undefined && totalConsulta > 0 ? Math.round((revisadosConsulta / totalConsulta) * 100) : null;
  const motivosGrafica = (auditoria?.motivos ?? []).slice(0, 9);
  const maxMotivo = Math.max(1, ...motivosGrafica.map((m) => m.n + (m.revisados ?? 0)));
  const maxDia = Math.max(1, ...(revisadosResumen?.dias.map((d) => d.n) ?? [0]));
  const porcentajeSinCoord =
    general && general.puntos > 0 ? Math.round((general.sin_ubicacion / general.puntos) * 1000) / 10 : 0;

  // Turno de entrada de cada tarjeta, en el orden en que aparecen.
  let turno = 0;
  const entrada = () => ({ "--i": turno++ }) as React.CSSProperties;

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------ saludo */}
      <div className="entra flex flex-wrap items-end justify-between gap-x-6 gap-y-4" style={entrada()}>
        <div className="min-w-0">
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] sm:text-[28px]">
            {saludo} <span aria-hidden>👋</span>
          </h1>
          <p className="mt-1 text-[14px] text-[var(--color-tinta-suave)]">{hoy ? `${hoy} · así está la cartera hoy` : " "}</p>
        </div>
        {puede("cargar") && (
          <button type="button" onClick={() => irA("cargar")} className="boton boton-primario">
            <Upload size={16} aria-hidden />
            Cargar plantilla
          </button>
        )}
      </div>

      {errorResumen && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-[12px] bg-[var(--color-alerta-fondo)] px-3 py-2.5 text-[13px] text-[var(--color-alerta)]"
        >
          <TriangleAlert size={14} className="shrink-0" aria-hidden />
          {errorResumen}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-12">
        {/* ---------------------------------------------------------- tarjeta principal */}
        <section
          aria-labelledby="puntos-asignados"
          style={entrada()}
          className="tarjeta-heroe entra relative isolate flex min-h-[188px] flex-col overflow-hidden rounded-[20px] p-5 xl:col-span-3"
        >
          <span aria-hidden className="absolute -top-16 -right-14 -z-10 h-44 w-44 rounded-full bg-white/15 blur-2xl" />
          <span aria-hidden className="absolute -bottom-20 -left-10 -z-10 h-40 w-40 rounded-full bg-white/15 blur-3xl" />
          <div className="flex items-start justify-between gap-3">
            <h2 id="puntos-asignados" className="text-[13px] font-medium opacity-85">
              Puntos asignados
            </h2>
            {puede("consultores") && (
              <a
                href="#consultores"
                aria-label="Ver la cartera de un consultor"
                title="Ver la cartera de un consultor"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--heroe-texto)_18%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--heroe-texto)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--heroe-texto)_28%,transparent)]"
              >
                <ArrowUpRight size={16} aria-hidden />
              </a>
            )}
          </div>
          {general ? (
            <>
              <p className="cifras mt-1 text-[36px] leading-none font-semibold tracking-[-0.02em]">
                {cifra(general.asignados ?? general.puntos)}
              </p>
              <p className="mt-2 text-[12px] leading-snug opacity-80">
                {general.puntos === 0
                  ? "Todavía no hay cartera cargada"
                  : `de ${cifra(general.puntos)} en total${general.libres ? ` · ${cifra(general.libres)} sin consultor` : ""}`}
              </p>
            </>
          ) : (
            <p className="mt-3 h-9 w-28 animate-pulse rounded-[10px] bg-[color-mix(in_srgb,var(--heroe-texto)_20%,transparent)]" />
          )}
          <div className="mt-auto flex flex-wrap gap-2 pt-5">
            {puede("cargar") && (
              <button
                type="button"
                onClick={() => irA("cargar")}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-[var(--heroe-texto)] px-4 text-[13px] font-semibold text-[var(--heroe-3)] shadow-sm hover:opacity-90"
              >
                Cargar
                <ArrowUp size={14} aria-hidden />
              </button>
            )}
            {puede("territorio") && (
              <a
                href="#territorio"
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--heroe-texto)_15%,transparent)] px-4 text-[13px] font-semibold ring-1 ring-[color-mix(in_srgb,var(--heroe-texto)_25%,transparent)] hover:bg-[color-mix(in_srgb,var(--heroe-texto)_25%,transparent)]"
              >
                Descargar
                <ArrowDown size={14} aria-hidden />
              </a>
            )}
          </div>
        </section>

        {/* ---------------------------------------------------------- la cartera hoy */}
        <section
          aria-labelledby="cartera-hoy"
          style={entrada()}
          className="tarjeta entra flex flex-col p-5 lg:order-last lg:col-span-2 xl:order-none xl:col-span-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h2 id="cartera-hoy" className="text-[15px] font-semibold">
              La cartera hoy
            </h2>
            {ultima ? (
              <span className="cifras truncate text-[12px] text-[var(--color-tinta-suave)]" title={ultima.archivo}>
                Último cargue {cuando(ultima.created_at)}
              </span>
            ) : resumen ? (
              <span className="text-[12px] text-[var(--color-tinta-suave)]">Sin cargas todavía</span>
            ) : null}
          </div>
          <div className="mt-4 grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              {
                Icono: Users,
                nombre: "Consultores",
                valor: general ? general.consultores : undefined,
                pastilla: "con puntos",
                nota:
                  general?.consultores === null
                    ? "Falta la vista resumen_consultores (supabase/gestion.sql)"
                    : "Con al menos un punto",
                tono: "neutro" as const,
              },
              {
                Icono: MapPin,
                nombre: "Sin coordenadas",
                valor: general ? general.sin_ubicacion : undefined,
                pastilla: `${porcentajeSinCoord.toLocaleString("es-CO")} %`,
                nota: "No salen en el mapa",
                tono: (general?.sin_ubicacion ?? 0) > 0 ? ("alerta" as const) : ("bien" as const),
              },
              veAuditoria
                ? {
                    Icono: ClipboardCheck,
                    nombre: "Por revisar",
                    valor: auditoria ? auditoria.total : null,
                    pastilla: revisadosResumen?.hoy ? `−${cifra(revisadosResumen.hoy)} hoy` : "auditoría",
                    nota: auditoria ? "De la última auditoría" : "Consulta la auditoría para verlo",
                    tono: "bien" as const,
                  }
                : {
                    Icono: Users,
                    nombre: "Sin consultor",
                    valor: general ? (general.libres ?? null) : undefined,
                    pastilla: "LIBRE",
                    nota: "En toda la cartera",
                    tono: "neutro" as const,
                  },
            ].map((c) => (
              <div
                key={c.nombre}
                className="flex flex-col rounded-[16px] border border-[var(--color-linea)] bg-[var(--color-sutil)] px-4 py-3.5"
              >
                <p className="flex items-center gap-1.5 text-[12px] text-[var(--color-tinta-suave)]">
                  <c.Icono size={14} aria-hidden />
                  {c.nombre}
                </p>
                <div className="mt-2 flex items-end justify-between gap-2">
                  {c.valor === undefined ? (
                    <span className="h-6 w-14 animate-pulse rounded-[8px] bg-[var(--color-relleno)]" />
                  ) : (
                    <span className="cifras text-[24px] leading-none font-semibold tracking-[-0.01em]">
                      {c.valor === null ? "—" : cifra(c.valor)}
                    </span>
                  )}
                  <span
                    className={`cifras rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                      c.tono === "alerta"
                        ? "bg-[var(--color-alerta-fondo)] text-[var(--color-alerta)]"
                        : c.tono === "bien"
                          ? "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]"
                          : "bg-[var(--color-relleno)] text-[var(--color-tinta-suave)]"
                    }`}
                  >
                    {c.pastilla}
                  </span>
                </div>
                <p className="mt-auto pt-2.5 text-[11px] leading-snug text-[var(--color-marcador)]">{c.nota}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------- revisados, barras finas */}
        {veAuditoria && (
          <section aria-labelledby="mini-revisados" style={entrada()} className="tarjeta entra flex flex-col p-5 xl:col-span-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="mini-revisados" className="text-[15px] font-semibold">
                <a href="#revisados" className="hover:text-[var(--color-acento-tinta)]">
                  Revisados
                </a>
              </h2>
              <span className="cifras text-[22px] leading-none font-semibold">
                {revisadosResumen ? cifra(revisadosResumen.total) : "—"}
              </span>
            </div>
            {revisadosResumen ? (
              <>
                <div
                  role="img"
                  aria-label={`Hallazgos revisados por día en las últimas dos semanas. Hoy: ${cifra(revisadosResumen.hoy)}. En los últimos 7 días: ${cifra(revisadosResumen.semana)}.`}
                  className="mt-4 flex h-[78px] items-end gap-[5px]"
                >
                  {revisadosResumen.dias.map((d, i) => {
                    const hoyEs = i === revisadosResumen.dias.length - 1;
                    return (
                      <span
                        key={d.dia}
                        className="con-globo relative flex h-full min-w-0 flex-1 items-end"
                      >
                        <span
                          className={`crece-y block w-full rounded-full ${
                            d.n === 0 ? "bg-[var(--color-fantasma)]" : "bg-[var(--color-acento)]"
                          } ${hoyEs ? "ring-2 ring-[var(--color-acento-suave)]" : ""}`}
                          style={{
                            height: d.n === 0 ? "26%" : `${Math.max(26, (d.n / maxDia) * 100)}%`,
                            ["--i" as string]: i,
                            ["--desde" as string]: "350ms",
                          }}
                        />
                        <span aria-hidden className={`globo ${i < 3 ? "globo-izq" : i > revisadosResumen.dias.length - 4 ? "globo-der" : ""}`}>
                          {hoyEs ? "Hoy" : diaCorto(d.dia).slice(0, 5)}: <b className="font-semibold">{cifra(d.n)}</b>
                        </span>
                      </span>
                    );
                  })}
                </div>
                <p className="mt-3 flex items-center gap-3 text-[11px] text-[var(--color-tinta-suave)]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[var(--color-acento)]" aria-hidden />
                    Por día
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[var(--color-fantasma)]" aria-hidden />
                    Sin revisiones
                  </span>
                  <span className="cifras ml-auto font-medium text-[var(--color-tinta)]">{cifra(revisadosResumen.hoy)} hoy</span>
                </p>
              </>
            ) : (
              <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
                {avisoRevisados ?? "Cargando…"}
              </p>
            )}
          </section>
        )}

        {/* ---------------------------------------------------------- auditoría por motivo */}
        {veAuditoria && (
          <section
            aria-labelledby="resumen-auditoria"
            style={entrada()}
            className="tarjeta entra flex flex-col p-5 sm:p-6 lg:col-span-2 xl:col-span-8"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="resumen-auditoria" className="text-[15px] font-semibold">
                  Auditoría de datos por motivo
                </h2>
                <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--color-tinta-suave)]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--color-acento)]" aria-hidden />
                    Por revisar
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--color-revisado)]" aria-hidden />
                    Revisados
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--color-fantasma)]" aria-hidden />
                    Escala
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => consulta.consultar(true)}
                disabled={consulta.trabajando}
                title={auditoria ? "Volver a consultar la auditoría" : "Consultar la auditoría"}
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full border border-[var(--color-linea)] px-3 text-[12px] text-[var(--color-tinta-suave)] hover:border-[var(--color-acento)] hover:text-[var(--color-tinta)] disabled:opacity-50"
              >
                {consulta.trabajando ? (
                  <Loader2 size={13} className="animate-spin" aria-hidden />
                ) : (
                  <RefreshCw size={13} aria-hidden />
                )}
                {auditoria ? `Consultada ${cuando(auditoria.momento)}` : "Consultar ahora"}
              </button>
            </div>

            {consulta.trabajando || consulta.fase.tipo === "error" ? (
              <div className="mt-6">
                <ProgresoConsulta fase={consulta.fase} onReintentar={() => consulta.consultar(false)} />
              </div>
            ) : auditoria && motivosGrafica.length > 0 ? (
              <>
                <div className="mt-6 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
                  <div
                    aria-hidden
                    className="cifras flex h-[230px] flex-col justify-between pb-0.5 text-right text-[10px] text-[var(--color-marcador)]"
                  >
                    {[1, 0.75, 0.5, 0.25, 0].map((p) => (
                      <span key={p}>{cifra(Math.round(maxMotivo * p))}</span>
                    ))}
                  </div>
                  <div
                    role="img"
                    aria-label={`Hallazgos por motivo. ${motivosGrafica
                      .map((m) => `${m.nombre}: ${cifra(m.n)} por revisar${m.revisados ? `, ${cifra(m.revisados)} revisados` : ""}`)
                      .join("; ")}.`}
                    className="flex h-[230px] items-stretch gap-2 sm:gap-3"
                  >
                    {motivosGrafica.map((m, i) => {
                      const rev = m.revisados ?? 0;
                      return (
                        <div
                          key={m.nombre}
                          className={`con-globo relative flex min-w-0 flex-1 flex-col justify-end gap-[3px] rounded-[12px] bg-[var(--color-fantasma)] p-[3px] ${
                            i >= 6 ? "max-sm:hidden" : ""
                          }`}
                        >
                          {rev > 0 && (
                            <span
                              className="crece-y block w-full rounded-[9px] bg-[var(--color-revisado)]"
                              style={{
                                height: `${Math.max(4, (rev / maxMotivo) * 100)}%`,
                                ["--i" as string]: i,
                                ["--desde" as string]: "500ms",
                              }}
                            />
                          )}
                          <span
                            className="crece-y block w-full rounded-[9px] bg-[var(--color-acento)] shadow-[0_8px_18px_-10px_var(--color-acento)]"
                            style={{ height: `${Math.max(3, (m.n / maxMotivo) * 100)}%`, ["--i" as string]: i }}
                          />
                          <span
                            aria-hidden
                            className={`globo ${i < 3 ? "globo-izq" : "globo-der"}`}
                          >
                            <b className="font-semibold">{m.nombre}</b>
                            <br />
                            {cifra(m.n)} por revisar · {cifra(rev)} revisados
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <span />
                  <div aria-hidden className="mt-2 flex gap-2 sm:gap-3">
                    {motivosGrafica.map((m, i) => (
                      <span
                        key={m.nombre}
                        className={`min-w-0 flex-1 truncate text-center text-[11px] text-[var(--color-tinta-suave)] ${
                          i >= 6 ? "max-sm:hidden" : ""
                        }`}
                        title={m.nombre}
                      >
                        {MOTIVO_CORTO[m.nombre] ?? m.nombre}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--color-linea)] pt-4 text-[13px]">
                  <span className="cifras">
                    <b className="font-semibold">{cifra(auditoria.total)}</b>{" "}
                    <span className="text-[var(--color-tinta-suave)]">
                      {auditoria.total === 1 ? "hallazgo por revisar" : "hallazgos por revisar"} · {cifra(auditoria.consultores)}{" "}
                      consultores
                    </span>
                  </span>
                  {avance !== null && (
                    <span className="cifras inline-flex items-center gap-2 text-[var(--color-tinta-suave)]">
                      <span
                        role="progressbar"
                        aria-label="Hallazgos revisados de la última consulta"
                        aria-valuenow={avance}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--color-fantasma)]"
                      >
                        <span
                          className="crece-x block h-full rounded-full bg-[var(--color-exito)]"
                          style={{ width: `${avance === 0 ? 0 : Math.max(3, avance)}%` }}
                        />
                      </span>
                      {avance} % revisado
                    </span>
                  )}
                  <a href="#auditoria" className="ml-auto inline-flex items-center gap-1 font-medium text-[var(--color-acento-tinta)]">
                    Abrir la auditoría
                    <ArrowRight size={14} aria-hidden />
                  </a>
                </div>
              </>
            ) : auditoria ? (
              <p className="mt-4 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
                La última auditoría no encontró hallazgos por revisar.
              </p>
            ) : (
              <p className="mt-4 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
                Todavía no has consultado la auditoría desde este navegador. Al consultarla, aquí queda cuántos hallazgos hay
                por motivo y cuántos ya se revisaron.
              </p>
            )}
          </section>
        )}

        {/* ---------------------------------------------------------- asistente */}
        {puede("asistente") && (
          <section
            aria-labelledby="mini-asistente"
            style={entrada()}
            className={`tarjeta entra flex flex-col p-5 sm:p-6 lg:col-span-2 ${veAuditoria ? "xl:col-span-4" : "xl:col-span-12"}`}
          >
            <h2 id="mini-asistente" className="text-[15px] font-semibold">
              Asistente IA
            </h2>
            <div className="flex flex-1 flex-col items-center justify-center py-5 text-center">
              <span aria-hidden className="esfera flota h-[92px] w-[92px]" />
              <p className="mt-4 text-[14px] font-medium text-[var(--color-acento-tinta)]">¿En qué te ayudo hoy?</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGERENCIAS_INICIO.map((s) => (
                  <button
                    key={s.corta}
                    type="button"
                    onClick={() => preguntar(s.texto, false)}
                    title={s.texto}
                    className="inline-flex min-h-[30px] items-center gap-1.5 rounded-full border border-[var(--color-linea)] px-3 text-[12px] text-[var(--color-tinta-suave)] hover:border-[var(--color-acento)] hover:text-[var(--color-acento-tinta)]"
                  >
                    <Sparkles size={12} aria-hidden />
                    {s.corta}
                  </button>
                ))}
              </div>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (pregunta.trim()) preguntar(pregunta, true);
              }}
              className="flex min-h-[46px] items-center gap-2 rounded-full border border-[var(--color-linea)] bg-[var(--color-sutil)] py-1.5 pr-1.5 pl-4 focus-within:border-[var(--color-acento)]"
            >
              <Sparkles size={15} className="shrink-0 text-[var(--color-acento)]" aria-hidden />
              <input
                value={pregunta}
                onChange={(e) => setPregunta(e.target.value)}
                placeholder="Pregunta lo que quieras…"
                aria-label="Pregunta para el Asistente IA"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--color-tinta)] outline-none placeholder:text-[var(--color-marcador)]"
              />
              <button
                type="submit"
                disabled={!pregunta.trim()}
                className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-full bg-[var(--color-acento)] px-3.5 text-[12px] font-semibold text-[var(--color-sobre-acento)] disabled:opacity-50"
              >
                <Send size={13} aria-hidden />
                Enviar
              </button>
            </form>
          </section>
        )}

        {/* ---------------------------------------------------------- actividad */}
        <section
          aria-labelledby="actividad"
          style={entrada()}
          className="tarjeta entra overflow-hidden lg:col-span-2 xl:col-span-8"
        >
          <div className="flex items-center justify-between gap-3 px-5 pt-5 sm:px-6">
            <h2 id="actividad" className="text-[15px] font-semibold">
              Actividad reciente
            </h2>
            <span className="hidden text-[12px] text-[var(--color-tinta-suave)] sm:inline">Lo último que se hizo en el panel</span>
          </div>
          {actividad === null ? (
            <p className="flex items-center gap-2 px-6 py-5 text-[13px] text-[var(--color-tinta-suave)]">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Cargando…
            </p>
          ) : actividad.length === 0 ? (
            <p className="px-6 py-5 text-[13px] text-[var(--color-tinta-suave)]">Todavía no hay movimientos registrados.</p>
          ) : (
            <>
              <div className="mt-3 hidden overflow-x-auto md:block">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th scope="col">Qué pasó</th>
                      <th scope="col">Quién</th>
                      <th scope="col">Fecha y hora</th>
                      <th scope="col" className="text-right">
                        Tipo
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {actividad.slice(0, 6).map((a, i) => {
                      const { frase, detalle } = describir(a);
                      const { dia, hora } = fechaHora(a.momento);
                      const tipo = tipoDe(a.accion);
                      return (
                        <tr key={`${a.momento}-${i}`}>
                          <td className="max-w-[300px]">
                            <span className="block font-medium first-letter:uppercase">{frase}</span>
                            {detalle && (
                              <span className="cifras block truncate text-xs text-[var(--color-tinta-suave)]" title={detalle}>
                                {detalle}
                              </span>
                            )}
                          </td>
                          <td className="max-w-[170px] truncate" title={a.usuario ?? ""}>
                            {a.usuario ?? "Alguien"}
                          </td>
                          <td className="cifras whitespace-nowrap">
                            <span className="block">{dia}</span>
                            <span className="block text-xs text-[var(--color-tinta-suave)]">{hora}</span>
                          </td>
                          <td className="text-right">
                            <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tipo.clase}`}>
                              {tipo.nombre}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="mt-2 divide-y divide-[var(--color-linea)] md:hidden">
                {actividad.slice(0, 6).map((a, i) => {
                  const { frase, detalle } = describir(a);
                  const tipo = tipoDe(a.accion);
                  return (
                    <li key={`${a.momento}-${i}`} className="px-5 py-3">
                      <p className="flex items-start justify-between gap-3 text-[13px] leading-snug">
                        <span>
                          <b className="font-semibold">{a.usuario ?? "Alguien"}</b> {frase}
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${tipo.clase}`}>
                          {tipo.nombre}
                        </span>
                      </p>
                      <p className="cifras mt-0.5 truncate text-xs text-[var(--color-tinta-suave)]">
                        {[detalle, cuando(a.momento)].filter(Boolean).join(" · ")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {avisoActividad && <p className="px-6 pb-5 text-xs leading-relaxed text-[var(--color-tinta-suave)]">{avisoActividad}</p>}
        </section>

        {/* ---------------------------------------------------------- para revisar */}
        <section aria-labelledby="revisar" style={entrada()} className="tarjeta entra p-5 sm:p-6 lg:col-span-2 xl:col-span-4">
          <h2 id="revisar" className="text-[15px] font-semibold">
            Para revisar
          </h2>
          {!resumen ? (
            <p className="mt-3 text-[13px] text-[var(--color-tinta-suave)]">Cargando…</p>
          ) : pendientes.length === 0 ? (
            <p className="mt-3 text-[13px] text-[var(--color-tinta-suave)]">Todo en orden: no hay nada pendiente.</p>
          ) : (
            <ul className="mt-4 space-y-3.5">
              {pendientes.map((p) => (
                <li key={p.id}>
                  <div className="flex items-center gap-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${CIRCULO[p.tono]}`}>
                      <p.Icono size={16} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] leading-snug font-semibold">{p.titulo}</p>
                      <p className="mt-0.5 truncate text-xs text-[var(--color-tinta-suave)]" title={p.detalle}>
                        {p.detalle}
                      </p>
                    </div>
                    <span className="shrink-0 text-[var(--color-acento-tinta)]">{p.accion}</span>
                  </div>
                  {p.id === "observaciones" && verObservaciones && ultima && (
                    <ul className="cifras mt-2 max-h-48 space-y-1 overflow-y-auto pl-12 text-xs text-[var(--color-tinta-suave)]">
                      {ultima.detalle.map((o, i) => (
                        <li key={i}>
                          Fila {cifra(o.fila)}: {o.motivo}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------------------------------------------------------- departamentos */}
        <section
          aria-labelledby="departamentos"
          style={entrada()}
          className={`tarjeta entra p-5 sm:p-6 lg:col-span-2 ${atajos.length > 0 ? "xl:col-span-8" : "xl:col-span-12"}`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="departamentos" className="text-[15px] font-semibold">
              Puntos por departamento
              {general && general.puntos > 0 && (
                <span className="cifras font-normal text-[var(--color-tinta-suave)]"> · {cifra(general.puntos)} en total</span>
              )}
            </h2>
            {deptos && deptos.length > 0 && puede("territorio") && (
              <a href="#territorio" className="inline-flex items-center gap-1 text-[13px] font-medium text-[var(--color-acento-tinta)]">
                Ver {deptos.length === 1 ? "el departamento" : `los ${deptos.length} departamentos`}
                <ArrowRight size={14} aria-hidden />
              </a>
            )}
          </div>
          {deptos === null ? (
            <p className="mt-3 text-[13px] text-[var(--color-tinta-suave)]">
              {resumen ? "Para ver este resumen, ejecuta supabase/territorio.sql en el SQL Editor." : "Cargando…"}
            </p>
          ) : deptos.length === 0 ? (
            <p className="mt-3 text-[13px] text-[var(--color-tinta-suave)]">No hay puntos cargados.</p>
          ) : (
            <div className="cifras mt-5 grid grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)_auto] items-center gap-x-4 gap-y-3 text-[13px]">
              {deptos.slice(0, 6).map((d, i) => (
                <div key={d.nombre} className="contents">
                  <span className="truncate" title={d.nombre}>
                    {d.nombre}
                  </span>
                  <span className="h-2.5 rounded-full bg-[var(--color-fantasma)]">
                    <span
                      className="crece-x block h-2.5 rounded-full bg-[var(--color-acento)]"
                      style={{ width: `${Math.max(2, (d.puntos / maxDepto) * 100)}%`, ["--i" as string]: i }}
                    />
                  </span>
                  <span className="text-right font-medium">{cifra(d.puntos)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------- atajos */}
        {atajos.length > 0 && (
          <section aria-labelledby="atajos" style={entrada()} className="tarjeta entra p-5 sm:p-6 lg:col-span-2 xl:col-span-4">
            <h2 id="atajos" className="text-[15px] font-semibold">
              Atajos
            </h2>
            <ul className="-mx-2 mt-3">
              {atajos.map((a) => (
                <li key={a.id}>
                  <a href={`#${a.id}`} className="flex items-center gap-3 rounded-[14px] px-2 py-2.5 hover:bg-[var(--color-hover)]">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-[var(--color-acento-suave)] text-[var(--color-acento-tinta)]">
                      <a.Icono size={17} strokeWidth={1.9} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold">{a.titulo}</span>
                      <span className="block text-xs text-[var(--color-tinta-suave)]">{a.detalle}</span>
                    </span>
                    <ChevronRight size={16} className="text-[var(--color-marcador)]" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/** Nombres cortos para debajo de las barras; el completo sale al pasar el mouse. */
const MOTIVO_CORTO: Record<string, string> = {
  [MOTIVOS.cedula]: "Cédula",
  [MOTIVOS.nacimiento]: "Dueño <18",
  [MOTIVOS.domicilios]: "Domicilios",
  [MOTIVOS.select]: "Sin responder",
  [MOTIVOS.anos]: "Años >50",
  [MOTIVOS.porcentaje]: "% >100",
  [MOTIVOS.costos]: "Costos",
  [MOTIVOS.ventas]: "Ventas",
  [MOTIVOS.edad]: "Particip. <18",
  [MOTIVOS.otro]: "Otro",
};

/** Etiqueta de la actividad: de qué parte del panel es. */
function tipoDe(accion: string): { nombre: string; clase: string } {
  if (accion.startsWith("revisados"))
    return { nombre: "Revisados", clase: "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]" };
  if (accion.startsWith("usuario") || accion.startsWith("perfil"))
    return { nombre: "Usuarios", clase: "bg-[var(--color-morado-fondo)] text-[var(--color-morado-tinta)]" };
  if (accion.startsWith("query_fotos"))
    return { nombre: "Auditorías", clase: "bg-[var(--color-relleno)] text-[var(--color-tinta)]" };
  if (accion.startsWith("tablero"))
    return { nombre: "Tableros", clase: "bg-[var(--color-info-fondo)] text-[var(--color-info-tinta)]" };
  if (accion.startsWith("mantenimiento") || accion === "tema_cambiar")
    return { nombre: "Configuración", clase: "bg-[var(--color-aviso-fondo)] text-[var(--color-aviso-tinta)]" };
  return { nombre: "Cartera", clase: "bg-[var(--color-acento-suave)] text-[var(--color-acento-tinta)]" };
}

/** "2026-10-12" y "4:14 p. m.", en hora de Colombia. */
function fechaHora(iso: string): { dia: string; hora: string } {
  const f = new Date(iso);
  if (Number.isNaN(f.getTime())) return { dia: "", hora: "" };
  return {
    dia: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(f),
    hora: new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" }).format(f),
  };
}

const CIRCULO = {
  alerta: "bg-[var(--color-alerta-fondo)] text-[var(--color-alerta)]",
  aviso: "bg-[var(--color-aviso-fondo)] text-[var(--color-aviso-tinta)]",
  neutro: "bg-[var(--color-acento-suave)] text-[var(--color-acento-tinta)]",
};
