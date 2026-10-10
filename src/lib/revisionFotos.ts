/**
 * Revisión de las fotos de la auditoría de imágenes: tipos y la huella con
 * la que se reconoce cada foto. Lo usan el navegador y la ruta de la API.
 */

/** Correcta: la foto sirve. Revisar: hay que hablarlo con el consultor. */
export type EstadoRevision = "correcta" | "revisar";

export type Revision = {
  estado: EstadoRevision;
  revisado_por: string | null;
  actualizado: string | null;
};

/**
 * Huella de 53 bits de un texto (cyrb53). La consulta no trae el id de la
 * visita, así que la revisión se guarda contra el enlace de la foto, que es
 * único por visita. Se guarda la huella y no el enlace: los enlaces firmados
 * pueden pasar de mil caracteres.
 */
export function huella(texto: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `f${n.toString(36)}${texto.length.toString(36)}`;
}

/** Así se valida en la API que una clave salió de huella(). */
export const PATRON_CLAVE = /^f[0-9a-z]{4,24}$/;
