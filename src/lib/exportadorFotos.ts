/**
 * Exportador de fotos: una plantilla de Excel con el enlace de la foto de
 * cada fila (y el PDV, el código, el ciclo…) se convierte en la lista de
 * fotos del ZIP, cada una en su carpeta y con su nombre.
 *
 * Todo pasa en el navegador: el archivo no se sube a ningún lado. Sin DOM
 * aquí, para poder probarlo aparte.
 */
import type { CellValue, Workbook } from "exceljs";
import { cicloDePdv } from "./ciclosPdv";
import { nombreArchivo, type FotoZip } from "./fotosZip";

export type Valor = string | number | null;

/** «Foto_evidencia » → «FOTO EVIDENCIA»: para comparar títulos sin tildes, mayúsculas ni guiones bajos. */
const normalizar = (v: unknown) =>
  String(v ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export type PlantillaFotos = {
  nombre: string;
  /** El archivo tal cual, para leer otra hoja. */
  datos: ArrayBuffer;
  hojas: string[];
  hoja: string;
  /** Los títulos de la fila 1 (los vacíos como «Columna C», los repetidos con « (2)»). */
  encabezados: string[];
  /** Las filas con algún dato, desde la 2. */
  filas: FilaPlantilla[];
};

export type FilaPlantilla = {
  /** Número de fila en el Excel. */
  n: number;
  valores: Valor[];
  /** El enlace (hipervínculo) de cada celda que tenga uno; null si ninguna tiene. */
  enlaces: (string | null)[] | null;
};

/** En qué se basan las carpetas: una columna, el prefijo del PDV (PLT-, BV1-…) o ninguna. */
export type Carpetas = { tipo: "columna"; col: number } | { tipo: "prefijo" } | { tipo: "ninguna" };

export type ColumnasExportador = {
  foto: number;
  carpetas: Carpetas;
  /** La columna con el nombre del PDV (para el prefijo del ciclo), si hay. */
  pdv: number | null;
  /** Las columnas que forman el nombre de cada foto, en orden. */
  nombre: number[];
  /**
   * Una carpeta por PDV dentro de cada carpeta (de ciclo), con el mismo nombre
   * de la foto: «CICLO 0 - PILOTO/PLT-ALMACEN CARDENAS-10600749/PLT-ALMACEN
   * CARDENAS-10600749.jpg». Dos filas con el mismo nombre (el mismo PDV y
   * código) quedan en la misma carpeta.
   */
  carpetaPorPdv: boolean;
};

export class ErrorPlantilla extends Error {}

export const MAX_FILAS = 100_000;

const ES_ENLACE = /^https?:\/\/\S+$/i;
const NOMBRES_PDV = ["PDV", "NOMBRE PDV", "NOMBRE DEL PDV", "NOMBRE PERSONALIZADO", "NOMBRE", "RAZON SOCIAL", "ESTABLECIMIENTO", "TIENDA", "CLIENTE"];
const NOMBRES_CODIGO = ["BAVARIA", "CODIGO BAVARIA", "COD BAVARIA", "CODIGO", "COD", "COD PERSONALIZADO", "CODIGO PDV", "CODIGO CLIENTE"];

/** El texto de una celda: el resultado de una fórmula, el texto de un enlace… (los errores como #N/A, tal cual). */
function valorDe(v: CellValue): Valor {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "VERDADERO" : "FALSO";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("error" in v) return String((v as { error: unknown }).error ?? "");
    if ("result" in v) return valorDe((v as { result?: CellValue }).result ?? null);
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
    if ("text" in v) return valorDe((v as { text: CellValue }).text);
  }
  return String(v);
}

function enlaceDe(v: CellValue): string | null {
  if (v && typeof v === "object" && "hyperlink" in v) {
    const h = String((v as { hyperlink: unknown }).hyperlink ?? "").trim();
    return ES_ENLACE.test(h) ? h : null;
  }
  return null;
}

function letra(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Lee la plantilla (la primera hoja, si no se dice cuál). */
export async function leerPlantilla(
  archivo: { name: string; arrayBuffer: () => Promise<ArrayBuffer> },
  hoja?: string
): Promise<PlantillaFotos> {
  const datos = await archivo.arrayBuffer();
  let libro: Workbook;
  try {
    const ExcelJS = (await import("exceljs")).default;
    libro = new ExcelJS.Workbook();
    await libro.xlsx.load(datos);
  } catch {
    throw new ErrorPlantilla("No se pudo abrir el archivo. Guárdalo como Excel (.xlsx) y vuelve a intentar.");
  }
  const hojas = libro.worksheets.map((w) => w.name);
  const ws = hoja ? libro.getWorksheet(hoja) : libro.worksheets[0];
  if (!ws) throw new ErrorPlantilla(hoja ? `La hoja «${hoja}» no existe.` : "El archivo no tiene hojas.");

  const ancho = Math.max(ws.columnCount, 1);
  const vistos = new Map<string, number>();
  const encabezados: string[] = [];
  for (let c = 1; c <= ancho; c++) {
    const v = valorDe(ws.getCell(1, c).value);
    let t = v === null || String(v).trim() === "" ? `Columna ${letra(c)}` : String(v).trim();
    const n = (vistos.get(t.toUpperCase()) ?? 0) + 1;
    vistos.set(t.toUpperCase(), n);
    if (n > 1) t = `${t} (${n})`;
    encabezados.push(t);
  }

  const filas: FilaPlantilla[] = [];
  const ultima = ws.actualRowCount > 0 ? ws.rowCount : 0;
  for (let r = 2; r <= ultima; r++) {
    const fila = ws.getRow(r);
    if (!fila.hasValues) continue;
    const valores: Valor[] = [];
    let enlaces: (string | null)[] | null = null;
    let alguno = false;
    for (let c = 1; c <= ancho; c++) {
      const crudo = fila.getCell(c).value;
      const v = valorDe(crudo);
      valores.push(typeof v === "string" ? v.trim() || null : v);
      if (v !== null && String(v).trim() !== "") alguno = true;
      const e = enlaceDe(crudo);
      if (e) (enlaces ??= new Array(ancho).fill(null))[c - 1] = e;
    }
    if (!alguno) continue;
    filas.push({ n: r, valores, enlaces });
    if (filas.length > MAX_FILAS) {
      throw new ErrorPlantilla(`La plantilla tiene más de ${MAX_FILAS.toLocaleString("es-CO")} filas. Pártela en varios archivos.`);
    }
  }
  if (filas.length === 0) throw new ErrorPlantilla("La hoja no tiene filas con datos debajo de los títulos.");

  return { nombre: archivo.name, datos, hojas, hoja: ws.name, encabezados, filas };
}

/** Los enlaces de foto de una celda: varios separados por espacios o «|», o el hipervínculo de la celda. */
export function fotosDe(fila: FilaPlantilla, col: number): string[] {
  const texto = fila.valores[col];
  const deTexto = typeof texto === "string" ? texto.split(/[\s|]+/).filter((x) => ES_ENLACE.test(x)) : [];
  if (deTexto.length) return deTexto;
  const enlace = fila.enlaces?.[col];
  return enlace ? [enlace] : [];
}

/** Reconoce las columnas por el título y el contenido. null si ninguna trae enlaces. */
export function detectarColumnas(p: PlantillaFotos): ColumnasExportador | null {
  const titulos = p.encabezados.map(normalizar);
  const conEnlaces = p.encabezados.map((_, c) => p.filas.reduce((n, f) => n + (fotosDe(f, c).length > 0 ? 1 : 0), 0));
  const mas = Math.max(...conEnlaces);
  if (mas === 0) return null;
  const candidatas = conEnlaces.map((n, c) => c).filter((c) => conEnlaces[c] > 0);
  const foto =
    candidatas.find((c) => /FOTO|IMAGEN|EVIDENCIA/.test(titulos[c]) && conEnlaces[c] >= mas / 2) ??
    candidatas.find((c) => conEnlaces[c] === mas)!;

  const libre = (c: number) => c !== foto;
  const porNombre = (lista: string[], aparte: number | null = null) => {
    for (const nombre of lista) {
      const c = titulos.findIndex((t, i) => t === nombre && libre(i) && i !== aparte);
      if (c >= 0) return c;
    }
    return null;
  };
  const pdv = porNombre(NOMBRES_PDV) ?? (() => {
    const c = titulos.findIndex((t, i) => /\bPDV\b|PUNTO DE VENTA/.test(t) && libre(i));
    return c >= 0 ? c : null;
  })();
  const codigo = porNombre(NOMBRES_CODIGO, pdv) ?? (() => {
    const c = titulos.findIndex((t, i) => /^COD|BAVARIA/.test(t) && libre(i) && i !== pdv);
    return c >= 0 ? c : null;
  })();
  const ciclo = titulos.findIndex((t, i) => /\bCICLO\b/.test(t) && libre(i));

  const carpetas: Carpetas = ciclo >= 0 ? { tipo: "columna", col: ciclo } : pdv !== null ? { tipo: "prefijo" } : { tipo: "ninguna" };
  const nombre = [pdv, codigo].filter((c): c is number => c !== null);
  if (nombre.length === 0) {
    const primera = p.encabezados.findIndex((_, i) => libre(i));
    if (primera >= 0) nombre.push(primera);
  }
  return { foto, carpetas, pdv, nombre, carpetaPorPdv: true };
}

const texto = (v: Valor) => (v === null ? "" : typeof v === "number" ? String(v) : v.trim());

/** La carpeta de una fila. Vacía en la columna elegida: «SIN CICLO», «SIN DEPARTAMENTO»… */
export function carpetaDe(p: PlantillaFotos, col: ColumnasExportador, fila: FilaPlantilla): string {
  const c = col.carpetas;
  if (c.tipo === "ninguna") return "";
  if (c.tipo === "prefijo") return cicloDePdv(col.pdv === null ? "" : texto(fila.valores[col.pdv]));
  const v = texto(fila.valores[c.col]);
  if (v) return nombreArchivo(v, 80);
  return nombreArchivo(`SIN ${normalizar(p.encabezados[c.col])}`, 80);
}

/**
 * El nombre de la foto (sin extensión): las columnas elegidas unidas con «_».
 * Lo que ya está en el nombre no se repite: si el PDV es
 * «PLT-CHAPARRO-10737539» y el código 10737539, queda «PLT-CHAPARRO-10737539».
 */
export function nombreDe(col: ColumnasExportador, fila: FilaPlantilla): string {
  let nombre = "";
  for (const c of col.nombre) {
    const v = texto(fila.valores[c]);
    if (!v || nombre.toUpperCase().includes(v.toUpperCase())) continue;
    nombre = nombre ? `${nombre}_${v}` : v;
  }
  return nombreArchivo(nombre || `fila ${fila.n}`);
}

/** La carpeta del PDV dentro de la de su ciclo: el nombre de la foto, más corto para no pasar el largo de ruta de Windows. */
const subcarpeta = (nombre: string) => nombreArchivo(nombre, 100);

export type ResumenCarpeta = {
  carpeta: string;
  fotos: number;
  sinEnlace: number;
  /** Carpetas de PDV que salen adentro (0 si no se arman). */
  pdvs: number;
  /** Ruta de una foto dentro de la carpeta, sin la extensión: «PLT-CHAPARRO-10737539/PLT-CHAPARRO-10737539». */
  ejemplo: string | null;
};

/** Las carpetas que salen, con cuántas fotos y un nombre de ejemplo, en orden alfabético (CICLO 0, CICLO 1…). */
export function resumirCarpetas(p: PlantillaFotos, col: ColumnasExportador): ResumenCarpeta[] {
  const m = new Map<string, ResumenCarpeta & { subs: Set<string> }>();
  for (const f of p.filas) {
    const carpeta = carpetaDe(p, col, f);
    const r = m.get(carpeta) ?? { carpeta, fotos: 0, sinEnlace: 0, pdvs: 0, ejemplo: null, subs: new Set<string>() };
    const fotos = fotosDe(f, col.foto);
    if (fotos.length === 0) r.sinEnlace++;
    else {
      const nombre = nombreDe(col, f);
      r.fotos += fotos.length;
      if (col.carpetaPorPdv) r.subs.add(subcarpeta(nombre).toLowerCase());
      r.ejemplo ??= (col.carpetaPorPdv ? `${subcarpeta(nombre)}/` : "") + nombre + (fotos.length > 1 ? "_foto1" : "");
    }
    m.set(carpeta, r);
  }
  return [...m.values()]
    .map(({ subs, ...r }) => ({ ...r, pdvs: subs.size }))
    .sort((a, b) => a.carpeta.localeCompare(b.carpeta, "es", { numeric: true }));
}

/**
 * Las fotos para el ZIP, de las carpetas que no estén en `fuera`. Las filas sin
 * enlace van igual, para que queden en el índice con lo que traía la celda
 * (#N/A, vacía…). En el índice va la fila completa de la plantilla.
 */
export function fotosParaZip(p: PlantillaFotos, col: ColumnasExportador, fuera: ReadonlySet<string> = new Set()): FotoZip[] {
  const salida: FotoZip[] = [];
  for (const f of p.filas) {
    const carpeta = carpetaDe(p, col, f);
    if (fuera.has(carpeta)) continue;
    const fotos = fotosDe(f, col.foto);
    const nombre = nombreDe(col, f);
    const indice = [f.n, ...f.valores];
    if (fotos.length === 0) {
      // Sin foto no se arma la carpeta del PDV: queda solo en el índice.
      const tenia = texto(f.valores[col.foto]);
      salida.push({ url: null, carpeta, nombre, indice, motivo: tenia ? `Sin enlace de foto (la celda dice «${tenia.slice(0, 60)}»)` : "Sin enlace de foto (celda vacía)" });
      continue;
    }
    const destino = col.carpetaPorPdv ? [carpeta, subcarpeta(nombre)].filter(Boolean).join("/") : carpeta;
    fotos.forEach((url, i) => salida.push({ url, carpeta: destino, nombre: nombre + (fotos.length > 1 ? `_foto${i + 1}` : ""), indice }));
  }
  return salida;
}

/** Los títulos del índice para fotosParaZip: la fila del Excel y las columnas de la plantilla. */
export const encabezadoIndice = (p: PlantillaFotos) => ["fila", ...p.encabezados];

/** «plantilla_prueba.xlsx» → «Fotos_plantilla_prueba». */
export const nombreZip = (archivo: string) => `Fotos_${archivo.replace(/\.[^.]+$/, "")}`;
