/**
 * Archivos del Asistente IA, del lado del navegador.
 *
 * - Imágenes: se reducen (máximo 1600 px, JPEG) para que pesen poco y se
 *   suben a Gemini; la copia reducida va también a DeepSeek en ese mensaje.
 * - PDF: se suben tal cual a Gemini (DeepSeek no abre PDF).
 * - Word, Excel, PowerPoint, CSV y texto: se les saca el texto aquí mismo y
 *   viaja como texto a las dos IA.
 */

export type TipoAdjunto = "imagen" | "pdf" | "texto";

export type Preparado =
  | {
      ok: true;
      tipo: "imagen";
      nombre: string;
      mime: string;
      blob: Blob;
      /** Base64 sin el prefijo data:, para DeepSeek. */
      base64: string;
      /** Miniatura chica para mostrar en la conversación. */
      miniatura: string;
    }
  | { ok: true; tipo: "pdf"; nombre: string; mime: string; blob: Blob }
  | { ok: true; tipo: "texto"; nombre: string; contenido: string }
  | { ok: false; nombre: string; error: string };

/** Tope de Vercel para un envío, con margen. */
export const MAX_SUBIDA = 4_400_000;
/** Texto máximo por documento: más que eso no lo leen bien las IA. */
const MAX_TEXTO = 150_000;
const LADO_MAXIMO = 1600;

const EXT_TEXTO = [
  "txt", "csv", "tsv", "md", "json", "xml", "html", "htm", "log", "sql", "py", "js", "ts", "tsx",
  "jsx", "css", "yml", "yaml", "ini", "env", "sh", "r", "dax", "m",
];
const EXT_HOJA = ["xlsx", "xlsm", "xls", "ods"];

export const ACEPTA =
  "image/*,.pdf,.docx,.pptx,.xlsx,.xlsm,.xls,.ods," + EXT_TEXTO.map((e) => "." + e).join(",");

function extension(nombre: string) {
  return (nombre.split(".").pop() ?? "").toLowerCase();
}

export function pesoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`;
}

function recortar(texto: string): string {
  const limpio = texto.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return limpio.length > MAX_TEXTO
    ? limpio.slice(0, MAX_TEXTO) + "\n\n[… el documento sigue, pero se recortó aquí por tamaño]"
    : limpio;
}

function aBase64(blob: Blob): Promise<string> {
  return new Promise((resolver, fallar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(String(lector.result).split(",")[1] ?? "");
    lector.onerror = () => fallar(lector.error);
    lector.readAsDataURL(blob);
  });
}

async function imagen(archivo: File): Promise<Preparado> {
  let mapa: ImageBitmap;
  try {
    mapa = await createImageBitmap(archivo);
  } catch {
    // HEIC en un navegador que no lo abre: se sube tal cual si cabe.
    if (archivo.size <= MAX_SUBIDA && /heic|heif/i.test(archivo.type + archivo.name)) {
      return {
        ok: true,
        tipo: "imagen",
        nombre: archivo.name,
        mime: archivo.type || "image/heic",
        blob: archivo,
        base64: "",
        miniatura: "",
      };
    }
    return { ok: false, nombre: archivo.name, error: "No se pudo abrir la imagen." };
  }

  const escala = Math.min(1, LADO_MAXIMO / Math.max(mapa.width, mapa.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, Math.round(mapa.width * escala));
  lienzo.height = Math.max(1, Math.round(mapa.height * escala));
  const ctx = lienzo.getContext("2d")!;
  // Fondo blanco: un PNG transparente en JPEG quedaría negro.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.drawImage(mapa, 0, 0, lienzo.width, lienzo.height);

  const blob: Blob | null = await new Promise((r) => lienzo.toBlob(r, "image/jpeg", 0.85));
  if (!blob) return { ok: false, nombre: archivo.name, error: "No se pudo preparar la imagen." };

  const mini = document.createElement("canvas");
  const e2 = Math.min(1, 160 / Math.max(lienzo.width, lienzo.height));
  mini.width = Math.max(1, Math.round(lienzo.width * e2));
  mini.height = Math.max(1, Math.round(lienzo.height * e2));
  mini.getContext("2d")!.drawImage(lienzo, 0, 0, mini.width, mini.height);

  const nombre = /\.(jpe?g)$/i.test(archivo.name) ? archivo.name : archivo.name.replace(/\.[^.]+$/, "") + ".jpg";
  return {
    ok: true,
    tipo: "imagen",
    nombre,
    mime: "image/jpeg",
    blob,
    base64: await aBase64(blob),
    miniatura: mini.toDataURL("image/jpeg", 0.7),
  };
}

/** Quita las etiquetas de un XML de Office y deja el texto, un párrafo por línea. */
function textoDeXml(xml: string, parrafo: string, texto: string): string {
  const salida: string[] = [];
  for (const p of xml.split(new RegExp(`</${parrafo}>`))) {
    const partes = [...p.matchAll(new RegExp(`<${texto}(?: [^>]*)?>([^<]*)</${texto}>|<w:tab/>|<w:br/>`, "g"))].map(
      (m) => (m[0] === "<w:tab/>" ? "\t" : m[0] === "<w:br/>" ? "\n" : m[1])
    );
    const linea = partes.join("");
    if (linea.trim()) salida.push(linea);
  }
  return salida
    .join("\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function word(archivo: File): Promise<Preparado> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await archivo.arrayBuffer());
  const doc = zip.file("word/document.xml");
  if (!doc) return { ok: false, nombre: archivo.name, error: "El Word no tiene texto que leer." };
  const texto = textoDeXml(await doc.async("string"), "w:p", "w:t");
  return { ok: true, tipo: "texto", nombre: archivo.name, contenido: recortar(texto) };
}

async function powerpoint(archivo: File): Promise<Preparado> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await archivo.arrayBuffer());
  const diapositivas = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const partes: string[] = [];
  for (const [i, n] of diapositivas.entries()) {
    const texto = textoDeXml(await zip.file(n)!.async("string"), "a:p", "a:t");
    partes.push(`--- Diapositiva ${i + 1} ---\n${texto}`);
  }
  return { ok: true, tipo: "texto", nombre: archivo.name, contenido: recortar(partes.join("\n\n")) };
}

async function hoja(archivo: File): Promise<Preparado> {
  const XLSX = await import("xlsx");
  const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array", cellDates: true });
  const partes = libro.SheetNames.map(
    (n) => `--- Hoja «${n}» ---\n${XLSX.utils.sheet_to_csv(libro.Sheets[n], { blankrows: false })}`
  );
  return { ok: true, tipo: "texto", nombre: archivo.name, contenido: recortar(partes.join("\n\n")) };
}

/** Deja un archivo listo para la conversación, o dice por qué no se puede. */
export async function preparar(archivo: File): Promise<Preparado> {
  const ext = extension(archivo.name);
  try {
    if (archivo.type.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(ext)) {
      if (archivo.size > 25_000_000) return { ok: false, nombre: archivo.name, error: "La imagen pesa demasiado." };
      return await imagen(archivo);
    }
    if (ext === "pdf" || archivo.type === "application/pdf") {
      if (archivo.size > MAX_SUBIDA) {
        return {
          ok: false,
          nombre: archivo.name,
          error: `El PDF pesa ${pesoLegible(archivo.size)} y el máximo es 4 MB. Comprímelo o divídelo en partes.`,
        };
      }
      return { ok: true, tipo: "pdf", nombre: archivo.name, mime: "application/pdf", blob: archivo };
    }
    if (ext === "docx") return await word(archivo);
    if (ext === "pptx") return await powerpoint(archivo);
    if (EXT_HOJA.includes(ext)) return await hoja(archivo);
    if (EXT_TEXTO.includes(ext) || archivo.type.startsWith("text/")) {
      return { ok: true, tipo: "texto", nombre: archivo.name, contenido: recortar(await archivo.text()) };
    }
    if (ext === "doc" || ext === "ppt") {
      return { ok: false, nombre: archivo.name, error: "Ese formato es muy viejo: guárdalo como .docx, .pptx o PDF." };
    }
    return { ok: false, nombre: archivo.name, error: "Ese tipo de archivo no se puede leer aquí." };
  } catch (e) {
    console.error("[asistente archivo]", e);
    return { ok: false, nombre: archivo.name, error: "No se pudo leer el archivo." };
  }
}
