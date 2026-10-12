/**
 * Si un error de Supabase quiere decir que la tabla todavía no existe (falta
 * correr su archivo .sql). SOLO SERVIDOR.
 *
 * Según la versión de PostgREST llega distinto: un 404 sin mensaje al
 * escribir, "relation ... does not exist" (42P01) al leer, o "Could not find
 * the table ... in the schema cache" (PGRST205) en las versiones nuevas.
 */
export function esTablaFaltante(
  error: { message?: string; code?: string } | null | undefined,
  status?: number
): boolean {
  if (!error) return false;
  if (status === 404) return true;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /does not exist|schema cache/i.test(error.message ?? "");
}

/**
 * Si el error es porque a la tabla le falta una columna nueva (la tabla existe
 * pero su .sql es de una versión anterior). Hay que mirarlo ANTES que
 * esTablaFaltante, que con el mismo «does not exist» creería que falta la tabla.
 *
 * Al leer llega "column x.y does not exist" (42703); al escribir, "Could not
 * find the 'y' column of 'x' in the schema cache" (PGRST204).
 */
export function esColumnaFaltante(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column/i.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? "");
}

/** El texto del error para el log, aunque PostgREST no mande mensaje. */
export function textoError(
  error: { message?: string } | null | undefined,
  status?: number
): string {
  return error?.message || `respuesta ${status ?? "sin estado"} de Supabase`;
}
