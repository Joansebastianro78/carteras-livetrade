/**
 * El Excel del Generador de rutas, en el navegador (exceljs): leer los puntos
 * y escribir el mismo libro con las columnas NUM_RUTA y PERSONA y la hoja
 * Resumen_Rutas, como cluster_rutas.py. El resto del libro (columnas,
 * formatos, otras hojas) queda como venía.
 *
 * Dónde van NUM_RUTA y PERSONA: en las dos columnas siguientes a la última
 * con datos, sin dejar columnas vacías en medio (en la plantilla de la
 * cartera, que termina en LONGITUD, son AG y AH). El script las ponía
 * siempre en AH y AI, y con esa plantilla dejaba la AG vacía. Si el archivo
 * ya trae esas dos columnas (la plantilla completa, o un archivo que ya pasó
 * por aquí) se escriben ahí mismo; si quedaron después de columnas vacías, se
 * corren para cerrar el hueco.
 */
import type { Cell, CellValue, Workbook, Worksheet } from "exceljs";
import { normalizar, SIN_ASIGNAR, SIN_COORD, type OpcionesRutas, type ResultadoRutas } from "./rutas";

const HEADER_RUTA = "NUM_RUTA";
const HEADER_PERSONA = "PERSONA";
export const HOJA_RESUMEN = "Resumen_Rutas";

const NOMBRES_LAT = ["LATITUD", "LATITUDE", "LAT"];
const NOMBRES_LON = ["LONGITUD", "LONGITUDE", "LON", "LNG", "LONG"];
/** Encabezados (normalizados) de las columnas de ruta y persona que se reutilizan. */
const NOMBRES_RUTA = ["NUM RUTA", "NUM DE RUTA"];
const NOMBRE_PERSONA = "PERSONA";
/** Para el globo del mapa, si el archivo las trae. */
const NOMBRES_PDV = ["PDV", "NOMBRE PDV", "NOMBRE", "NOMBRE PERSONALIZADO", "RAZON SOCIAL", "ESTABLECIMIENTO", "TIENDA"];
const NOMBRES_ID = ["ID", "ID PDV", "CODIGO", "COD", "CODIGO BAVARIA", "BAVARIA", "COD PERSONALIZADO"];
const NOMBRES_DIR = ["DIRECCION", "DIRECCION PDV"];

/** Lo que hace falta de cada fila para el mapa. */
export type DatoFila = { fila: number; id: string | null; nombre: string | null; direccion: string | null };

export type ArchivoRutas = {
  nombre: string;
  /** El archivo tal cual, para volver a abrirlo al escribir. */
  datos: ArrayBuffer;
  hojas: string[];
  hoja: string;
  /** Filas del Excel (desde la 2) que traen datos. */
  filas: number[];
  latCrudas: (number | string | boolean | null)[];
  lonCrudas: (number | string | boolean | null)[];
  info: DatoFila[];
  /** Última columna de datos (sin NUM_RUTA ni PERSONA): de ella se copia el formato. */
  ultimaColumna: number;
  columnas: { lat: string; lon: string };
  /** Dónde se escriben las rutas (número de columna, 1 = A). */
  colRuta: number;
  colPersona: number;
  /** true: el archivo ya traía esas columnas y se conserva su encabezado. */
  reutiliza: boolean;
  /** Columnas NUM_RUTA / PERSONA viejas que quedaron después de un hueco y se vacían. */
  limpiar: number[];
};

export class ErrorArchivo extends Error {}

/** El valor que se ve en una celda: el resultado de una fórmula, el texto de un enlace… */
function valorDe(v: CellValue): number | string | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if ("result" in v) return valorDe((v as { result?: CellValue }).result ?? null);
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
    if ("text" in v) return String((v as { text: unknown }).text ?? "");
    if ("error" in v) return null;
  }
  return String(v);
}

const vacio = (v: unknown) => v === null || v === undefined || v === "";

async function abrir(datos: ArrayBuffer): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(datos);
  return libro;
}

export function columnaLetra(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Lee la hoja (la primera que no sea el resumen, si no se dice cuál). */
export async function leerArchivoRutas(archivo: File | { name: string; arrayBuffer: () => Promise<ArrayBuffer> }, hoja?: string): Promise<ArchivoRutas> {
  const datos = await archivo.arrayBuffer();
  let libro: Workbook;
  try {
    libro = await abrir(datos);
  } catch {
    throw new ErrorArchivo("No se pudo abrir el archivo. Guárdalo como Excel (.xlsx) y vuelve a intentar.");
  }
  const hojas = libro.worksheets.map((w) => w.name);
  const ws = hoja ? libro.getWorksheet(hoja) : libro.worksheets.find((w) => w.name !== HOJA_RESUMEN);
  if (!ws) throw new ErrorArchivo(hoja ? `La hoja «${hoja}» no existe.` : "El archivo no tiene hojas con datos.");

  const ancho = Math.max(ws.columnCount, 1);
  const encabezados = new Map<string, number>();
  for (let c = 1; c <= ancho; c++) {
    const v = valorDe(ws.getCell(1, c).value);
    if (v === null) continue;
    const clave = normalizar(v);
    if (!encabezados.has(clave)) encabezados.set(clave, c);
  }
  const buscar = (candidatos: string[]) => {
    for (const n of candidatos) if (encabezados.has(n)) return { col: encabezados.get(n)!, nombre: n };
    return null;
  };
  const cLat = buscar(NOMBRES_LAT);
  const cLon = buscar(NOMBRES_LON);
  if (!cLat || !cLon) throw new ErrorArchivo("No se encuentran las columnas LATITUD y LONGITUD en la fila 1.");

  // Columnas de ruta y persona que ya traiga el archivo.
  let rc: number | null = null;
  for (const n of NOMBRES_RUTA) if (rc === null && encabezados.has(n)) rc = encabezados.get(n)!;
  const pc = encabezados.get(NOMBRE_PERSONA) ?? null;
  const conEncabezado = (c: number) => !vacio(valorDe(ws.getCell(1, c).value));
  let ultimaGeneral = 0;
  for (let c = 1; c <= ancho; c++) if (conEncabezado(c)) ultimaGeneral = c;
  let ultimaDatos = 0;
  for (let c = 1; c <= ancho; c++) if (c !== rc && c !== pc && conEncabezado(c)) ultimaDatos = c;

  let colRuta: number;
  let colPersona: number;
  let reutiliza = false;
  let limpiar: number[] = [];
  let ultimaColumna: number;
  if (rc !== null && pc !== null && rc !== pc) {
    ultimaColumna = ultimaDatos;
    if (Math.min(rc, pc) <= ultimaDatos + 1) {
      // Ya están donde deben (pegadas a los datos o dentro de la plantilla).
      colRuta = rc;
      colPersona = pc;
      reutiliza = true;
    } else {
      // Quedaron después de columnas vacías: se corren para cerrar el hueco.
      colRuta = ultimaDatos + 1;
      colPersona = ultimaDatos + 2;
      limpiar = [rc, pc].filter((c) => c !== colRuta && c !== colPersona);
    }
  } else {
    ultimaColumna = ultimaGeneral;
    colRuta = ultimaGeneral + 1;
    colPersona = ultimaGeneral + 2;
  }
  if (ultimaColumna === 0) throw new ErrorArchivo("La fila 1 no tiene encabezados.");

  const cPdv = buscar(NOMBRES_PDV)?.col;
  const cId = buscar(NOMBRES_ID)?.col;
  const cDir = buscar(NOMBRES_DIR)?.col;
  const texto = (r: number, c: number | undefined) => {
    if (!c) return null;
    const v = valorDe(ws.getCell(r, c).value);
    return vacio(v) ? null : String(v).trim().slice(0, 160);
  };

  const filas: number[] = [];
  const latCrudas: ArchivoRutas["latCrudas"] = [];
  const lonCrudas: ArchivoRutas["lonCrudas"] = [];
  const info: DatoFila[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    let hay = false;
    for (let c = 1; c <= ultimaColumna && !hay; c++) hay = !vacio(valorDe(ws.getCell(r, c).value));
    if (!hay) continue;
    filas.push(r);
    latCrudas.push(valorDe(ws.getCell(r, cLat.col).value));
    lonCrudas.push(valorDe(ws.getCell(r, cLon.col).value));
    info.push({ fila: r, id: texto(r, cId), nombre: texto(r, cPdv), direccion: texto(r, cDir) });
  }
  if (filas.length === 0) throw new ErrorArchivo("El archivo no tiene filas con datos.");

  return {
    nombre: archivo.name,
    datos,
    hojas,
    hoja: ws.name,
    filas,
    latCrudas,
    lonCrudas,
    info,
    ultimaColumna,
    columnas: { lat: cLat.nombre, lon: cLon.nombre },
    colRuta,
    colPersona,
    reutiliza,
    limpiar,
  };
}

/** El nombre del archivo de salida: BOGOTA_1410.xlsx → BOGOTA_1410_RUTAS.xlsx. */
export function nombreSalida(entrada: string): string {
  return `${entrada.replace(/\.[^.]+$/, "")}_RUTAS.xlsx`;
}

const copia = <T>(x: T): T => (x === undefined || x === null ? x : (JSON.parse(JSON.stringify(x)) as T));
const tieneEstilo = (c: Cell) => Object.keys(c.style ?? {}).length > 0;

function fechaHora(d: Date): string {
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/** El libro con las rutas, listo para descargar. */
export async function escribirExcelRutas(a: ArchivoRutas, r: ResultadoRutas, op: OpcionesRutas, ahora = new Date()): Promise<Blob> {
  const libro = await abrir(a.datos);
  const ws = libro.getWorksheet(a.hoja) as Worksheet;

  // ---- columnas viejas que quedaron después de un hueco: se vacían
  for (const col of a.limpiar) {
    for (let fila = 1; fila <= ws.rowCount; fila++) {
      const c = ws.getCell(fila, col);
      c.value = null;
      c.style = {};
    }
  }

  // ---- NUM_RUTA / PERSONA
  const modeloH = ws.getCell(1, a.ultimaColumna);
  for (const [col, texto] of [[a.colRuta, HEADER_RUTA], [a.colPersona, HEADER_PERSONA]] as const) {
    // Si el archivo ya las traía (por ejemplo «num de ruta» de la plantilla), queda su encabezado.
    if (a.reutiliza) continue;
    const c = ws.getCell(1, col);
    c.value = texto;
    if (tieneEstilo(modeloH)) {
      c.font = copia(modeloH.font);
      c.fill = copia(modeloH.fill);
      c.border = copia(modeloH.border);
      c.alignment = copia(modeloH.alignment);
    }
  }
  if (!a.reutiliza) {
    ws.getColumn(a.colRuta).width = 11;
    ws.getColumn(a.colPersona).width = 18;
  }

  a.filas.forEach((fila, i) => {
    const num = r.ruta[i];
    const modelo = ws.getCell(fila, a.ultimaColumna);
    const estilo = tieneEstilo(modelo);
    for (const [col, valor] of [[a.colRuta, num], [a.colPersona, r.persona[i]]] as const) {
      const c = ws.getCell(fila, col);
      c.value = valor ?? null;
      if (estilo) {
        c.font = copia(modelo.font);
        c.border = copia(modelo.border);
      }
    }
    ws.getCell(fila, a.colRuta).alignment = { horizontal: "center" };
  });

  // ---- hoja resumen
  const anterior = libro.getWorksheet(HOJA_RESUMEN);
  if (anterior) libro.removeWorksheet(anterior.id);
  const rs = libro.addWorksheet(HOJA_RESUMEN);
  rs.addRow(["NUM_RUTA", "PERSONA", "CANT_PUNTOS", "LAT_CENTRO", "LON_CENTRO", "DIST_PROM_KM", "DIST_MAX_KM"]);
  for (const x of r.resumen) rs.addRow([x.num, x.persona, x.puntos, x.latCentro, x.lonCentro, x.distPromKm, x.distMaxKm]);
  if (r.sinAsignar) rs.addRow([null, SIN_ASIGNAR, r.sinAsignar]);
  if (r.sinCoordenadas) rs.addRow([null, SIN_COORD, r.sinCoordenadas]);
  rs.addRow([]);
  rs.addRow(["TOTAL", null, a.filas.length]);
  rs.addRow([]);
  rs.addRow(["Parametros"]);
  rs.addRow(["Archivo entrada", a.nombre]);
  rs.addRow(["Archivo salida", nombreSalida(a.nombre)]);
  rs.addRow(["Personas", op.personas]);
  rs.addRow(["Puntos por persona", op.puntosPorPersona]);
  rs.addRow(["Reparto", op.parejo ? "parejo (+/-1 punto)" : "solo maximo"]);
  if (r.aMano) {
    rs.addRow(["Asignados a mano", r.aMano]);
    rs.addRow(["Rutas al final", r.resumen.length]);
  }
  rs.addRow(["Generado", fechaHora(ahora)]);

  for (let c = 1; c <= 7; c++) {
    const celda = rs.getCell(1, c);
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF305496" } };
    celda.alignment = { horizontal: "center" };
  }
  rs.eachRow((fila, n) => {
    if (n > 1 && (fila.getCell(1).value === "TOTAL" || fila.getCell(1).value === "Parametros")) fila.getCell(1).font = { bold: true };
  });
  [24, 24, 13, 12, 12, 14, 13].forEach((ancho, i) => (rs.getColumn(i + 1).width = ancho));
  rs.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];

  const salida = await libro.xlsx.writeBuffer();
  return new Blob([salida], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
