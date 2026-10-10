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

/** El texto del error para el log, aunque PostgREST no mande mensaje. */
export function textoError(
  error: { message?: string } | null | undefined,
  status?: number
): string {
  return error?.message || `respuesta ${status ?? "sin estado"} de Supabase`;
}
