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
  motivos: { nombre: string; n: number }[];
};

const LLAVE = "cartera.resumen-auditoria";

export function resumirAuditoria(filas: FilaAuditoria[], momento: string | null): ResumenAuditoria {
  const conteo = new Map<string, number>();
  for (const f of filas) conteo.set(f.motivo, (conteo.get(f.motivo) ?? 0) + 1);
  return {
    momento: momento ?? new Date().toISOString(),
    total: filas.length,
    consultores: new Set(filas.map((f) => limpiarTexto(f.nombre_usuario)).filter(Boolean)).size,
    motivos: [...conteo.entries()]
      .map(([nombre, n]) => ({ nombre, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 6),
  };
}

export function guardarResumenAuditoria(r: ResumenAuditoria) {
  try {
    localStorage.setItem(LLAVE, JSON.stringify(r));
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
