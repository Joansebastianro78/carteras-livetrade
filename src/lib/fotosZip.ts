/**
 * Lo que comparten las descargas de fotos en ZIP (las galerías de las
 * auditorías y el Exportador de fotos) y la ruta /api/admin/foto. Sirve en el
 * navegador y en el servidor: aquí no se importa nada de ninguno de los dos.
 */

/** Una foto para el ZIP. */
export type FotoZip = {
  /** null: la fila no trae enlace; va al índice con `motivo`, sin descargar nada. */
  url: string | null;
  /** Carpeta dentro del ZIP ("" = la raíz; «CICLO 1/PDV» para una dentro de otra), cada parte ya limpia con nombreArchivo. */
  carpeta: string;
  /** Nombre del archivo sin la extensión, ya limpio con nombreArchivo. */
  nombre: string;
  /** La fecha que lleva el archivo dentro del ZIP. */
  fecha?: Date | null;
  /** Las columnas propias de esta foto en indice.xlsx. */
  indice: (string | number | null)[];
  /** Por qué no tiene enlace, para el índice. */
  motivo?: string;
};

export const EXTENSION_IMAGEN: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
};

/** Qué imagen es, por los primeros bytes (no por lo que diga el servidor). null si no es una imagen. */
export function tipoImagen(b: Uint8Array): string | null {
  const ascii = (desde: number, hasta: number) => String.fromCharCode(...b.subarray(desde, hasta));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return "image/png";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (b.length >= 6 && /^GIF8[79]a$/.test(ascii(0, 6))) return "image/gif";
  if (b.length >= 12 && ascii(4, 8) === "ftyp" && /^(heic|heix|mif1|msf1|hevc)$/.test(ascii(8, 12))) return "image/heic";
  return null;
}

/** Un nombre que sirva de archivo o carpeta en Windows: sin \ / : * ? " < > | ni puntos al final. */
export function nombreArchivo(texto: string, largo = 150): string {
  return (
    texto
      .normalize("NFC")
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, largo)
      .replace(/[. ]+$/, "") || "sin nombre"
  );
}
