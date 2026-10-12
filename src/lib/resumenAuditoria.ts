import type { FilaAuditoria } from "./auditoria";
import { limpiarTexto } from "./limpiadorAuditoria";

/**
 * Lo último que se vio en la auditoría de datos, para mostrarlo en el Inicio
 * sin volver a correr la consulta. Queda en este navegador (localStorage): es
 * un resumen de conteos, sin datos de los puntos.
 */

export type ResumenAuditoria = {
  /** Cuándo se consultó, ISO. */
  momento: string;
  total: number;
  consultores: number;
  /** n: por revisar; revisados: los de ese motivo ya revisados (no viene en resúmenes viejos). */
  motivos: { nombre: string; n: number; revisados?: number }[];
  /** Cuántos de esa consulta ya estaban revisados (no viene en resúmenes viejos). */
  revisados?: number;
};

const LLAVE = "cartera.resumen-auditoria";

/** Avisa en esta pestaña que cambió el resumen (lo escucha la campana). */
export const EVENTO_RESUMEN_AUDITORIA = "cartera:resumen-auditoria";

/**
 * filas: lo que falta revisar. revisadas: lo de la misma consulta que ya se
 * revisó, para el avance por motivo del Inicio.
 */
export function resumirAuditoria(
  filas: FilaAuditoria[],
  momento: string | null,
  revisadas: FilaAuditoria[] = []
): ResumenAuditoria {
  const conteo = new Map<string, number>();
  const yaRevisados = new Map<string, number>();
  for (const f of filas) conteo.set(f.motivo, (conteo.get(f.motivo) ?? 0) + 1);
  for (const f of revisadas) yaRevisados.set(f.motivo, (yaRevisados.get(f.motivo) ?? 0) + 1);
  return {
    momento: momento ?? new Date().toISOString(),
    total: filas.length,
    consultores: new Set(filas.map((f) => limpiarTexto(f.nombre_usuario)).filter(Boolean)).size,
    // Todos los motivos (son diez), de más a menos hallazgos en total.
    motivos: [...new Set([...conteo.keys(), ...yaRevisados.keys()])]
      .map((nombre) => ({ nombre, n: conteo.get(nombre) ?? 0, revisados: yaRevisados.get(nombre) ?? 0 }))
      .sort((a, b) => b.n + b.revisados - (a.n + a.revisados))
      .slice(0, 10),
    revisados: revisadas.length,
  };
}

export function guardarResumenAuditoria(r: ResumenAuditoria) {
  try {
    localStorage.setItem(LLAVE, JSON.stringify(r));
    window.dispatchEvent(new Event(EVENTO_RESUMEN_AUDITORIA));
  } catch {
    // Navegador en modo privado o sin espacio: el Inicio solo no lo mostrará.
  }
}

export function leerResumenAuditoria(): ResumenAuditoria | null {
  try {
    const crudo = localStorage.getItem(LLAVE);
    if (!crudo) return null;
    const r = JSON.parse(crudo) as ResumenAuditoria;
    return typeof r.total === "number" && Array.isArray(r.motivos) ? r : null;
  } catch {
    return null;
  }
}
