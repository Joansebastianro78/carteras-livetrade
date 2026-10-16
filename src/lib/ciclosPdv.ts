/**
 * El ciclo de un PDV, por el prefijo de su nombre personalizado (PLT-, BV1-…).
 * Lo usa la descarga de fotos en ZIP para separarlas en carpetas.
 *
 * El orden importa: los subciclos (BV1-1-, BV2-1-) van antes que su ciclo
 * (BV1-, BV2-), porque «BV1-1-…» también empieza por «BV1-».
 */
export const CICLOS_PDV: [prefijo: string, carpeta: string][] = [
  ["PLT-", "CICLO 0 - PILOTO"],
  ["BV1-1-", "CICLO 1.1 - SUB CICLO"],
  ["BV1-", "CICLO 1"],
  ["BV2-1-", "CICLO 2.1 - SUB CICLO"],
  ["BV2-", "CICLO 2"],
  ["BV3-", "CICLO 3"],
  ["BV4-", "CICLO 4"],
  ["BV5-", "CICLO 5"],
  ["BV6-", "CICLO 6"],
];

/** Para los PDV cuyo nombre no empieza por ninguno de esos prefijos. */
export const SIN_CICLO = "SIN CICLO";

export function cicloDePdv(nombre: string | null | undefined): string {
  const n = (nombre ?? "").trim().toUpperCase();
  return CICLOS_PDV.find(([prefijo]) => n.startsWith(prefijo))?.[1] ?? SIN_CICLO;
}
