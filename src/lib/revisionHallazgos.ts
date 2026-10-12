import type { FilaAuditoria } from "./auditoria";
import { limpiarTexto } from "./limpiadorAuditoria";
import { huella } from "./revisionFotos";

/**
 * Hallazgos de la auditoría de datos que alguien ya revisó (tabla
 * revision_hallazgos, en supabase/hallazgos.sql). Lo usan el navegador y la
 * ruta /api/admin/revision-hallazgos.
 *
 * Un hallazgo revisado sale de la lista de la auditoría y pasa a la sección
 * «Revisados», con quién lo marcó y cuándo.
 */

/** Lo que queda guardado de cada hallazgo revisado. */
export type HallazgoRevisado = {
  clave: string;
  codigo_bavaria: string | null;
  pdv: string | null;
  consultor: string | null;
  departamento: string | null;
  provincia: string | null;
  pregunta: string | null;
  respuesta: string | null;
  motivo: string | null;
  tipo_linea: string | null;
  actividad_id: string | null;
  fecha_hallazgo: string | null;
  revisado_por: string | null;
  revisado_en: string;
  /** Lo que se anotó en la carga masiva. No viene si falta volver a correr hallazgos.sql. */
  observacion?: string | null;
  /** El Excel de la carga masiva; null si se marcó uno por uno. */
  archivo?: string | null;
};

/** Lo que manda el navegador al marcar: la copia del hallazgo, sin quién ni cuándo. */
export type CopiaHallazgo = Omit<HallazgoRevisado, "revisado_por" | "revisado_en">;

/** Cuántos se han revisado y cuándo, para la gráfica del Inicio. */
export type ResumenRevisados = {
  total: number;
  hoy: number;
  /** Hoy y los seis días anteriores. */
  semana: number;
  /** Los últimos 14 días, del más antiguo a hoy, en hora de Colombia. */
  dias: { dia: string; n: number }[];
  /** Quién ha revisado más, de mayor a menor (hasta 5). */
  personas: { usuario: string; n: number }[];
};

/**
 * Con qué se reconoce un hallazgo entre una consulta y otra: la actividad
 * (el formulario), el punto, la pregunta, la respuesta y la fecha, tal como
 * los trae Athena. Si la respuesta se corrige y sigue mal, cambia la clave y
 * el hallazgo vuelve a salir como pendiente: es otra respuesta.
 */
export function claveHallazgo(f: FilaAuditoria): string {
  return huella(
    [f.actividad_id, f.codigo_bavaria, f.componente_etiqueta, f.componente_valor, f.fecha]
      .map((v) => (v ?? "").trim())
      .join("␟")
  );
}

/** La copia que se guarda, con los textos ya limpios para mostrarlos. */
export function copiaDelHallazgo(f: FilaAuditoria, clave = claveHallazgo(f)): CopiaHallazgo {
  return {
    clave,
    codigo_bavaria: limpiarTexto(f.codigo_bavaria),
    pdv: limpiarTexto(f.nombre_personalizado),
    consultor: limpiarTexto(f.nombre_usuario),
    departamento: limpiarTexto(f.departamento),
    provincia: limpiarTexto(f.provincia),
    pregunta: limpiarTexto(f.componente_etiqueta),
    respuesta: limpiarTexto(f.componente_valor),
    motivo: f.motivo,
    tipo_linea: limpiarTexto(f.tipo_linea),
    actividad_id: limpiarTexto(f.actividad_id),
    fecha_hallazgo: limpiarTexto(f.fecha),
  };
}

/**
 * Las claves de los hallazgos ya revisados, para sacarlos de la lista.
 * aviso: falta la tabla (hallazgos.sql) o no se pudo leer; en ese caso la
 * auditoría se ve completa, como antes.
 */
export async function leerClavesRevisadas(): Promise<{ claves: Set<string>; aviso: string | null }> {
  try {
    const r = await fetch("/api/admin/revision-hallazgos?campos=claves");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { claves: new Set(), aviso: j.error ?? "No se pudieron leer los hallazgos revisados." };
    return { claves: new Set<string>(j.claves ?? []), aviso: j.aviso ?? null };
  } catch {
    return { claves: new Set(), aviso: "No se pudieron leer los hallazgos revisados." };
  }
}

/** El resumen para la gráfica del Inicio. aviso: falta la tabla o no se pudo leer. */
export async function leerResumenRevisados(): Promise<{ resumen: ResumenRevisados | null; aviso: string | null }> {
  try {
    const r = await fetch("/api/admin/revision-hallazgos?campos=resumen");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { resumen: null, aviso: j.error ?? "No se pudo leer el resumen de revisados." };
    return { resumen: (j.resumen as ResumenRevisados | null) ?? null, aviso: j.aviso ?? null };
  } catch {
    return { resumen: null, aviso: "No se pudo leer el resumen de revisados." };
  }
}
