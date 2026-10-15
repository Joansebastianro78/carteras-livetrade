/**
 * Qué se ve en las fotos, según la IA (Auditoría con query): las etiquetas
 * que se le piden buscar y cómo se leen. Lo usan el navegador y la ruta
 * /api/admin/fotos-ia; aquí no se importa nada del servidor.
 */

export const MAX_ETIQUETAS = 8;
export const MAX_LARGO_ETIQUETA = 40;
/** Fotos por pregunta a la IA. */
export const FOTOS_POR_PREGUNTA = 10;

/** Se guarda aparte: la foto está borrosa, oscura o no se entiende. */
export const ILEGIBLE = "ilegible";

export const ETIQUETAS_POR_DEFECTO = "libro, afiche, persona, productos";

/** Por foto: cada etiqueta y si la IA la vio. */
export type Vistas = Record<string, boolean>;

/** «Libro, AFICHE;  persona» → ["libro", "afiche", "persona"]. */
export function leerEtiquetas(texto: unknown): string[] {
  if (typeof texto !== "string") return [];
  const salida: string[] = [];
  for (const parte of texto.split(/[,;\n]+/)) {
    const e = parte.replace(/\s+/g, " ").trim().toLowerCase().slice(0, MAX_LARGO_ETIQUETA);
    if (!e || e === ILEGIBLE || salida.includes(e)) continue;
    salida.push(e);
    if (salida.length >= MAX_ETIQUETAS) break;
  }
  return salida;
}

/** «libro» → «Libro». */
export const nombreEtiqueta = (e: string) => e.charAt(0).toUpperCase() + e.slice(1);
