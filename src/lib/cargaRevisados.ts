import * as XLSX from "xlsx";
import { MOTIVOS, type FilaAuditoria } from "./auditoria";
import { diaCorto, leerFecha } from "./fechas";
import { limpiarTexto } from "./limpiadorAuditoria";
import { copiaDelHallazgo, type CopiaHallazgo } from "./revisionHallazgos";

/**
 * Carga masiva de hallazgos revisados (Auditoría de datos › Carga masiva).
 * Solo navegador.
 *
 * El Excel trae una fila por PDV, o por PDV y motivo: CODIGO BAVARIA
 * (obligatorio), MOTIVO, FECHA y OBSERVACION. Cada fila se cruza con los
 * hallazgos de la consulta abierta y marca los pendientes que le
 * correspondan. Nada se guarda hasta que la persona ve el cruce y confirma.
 */

export const MAXIMO_FILAS = 5000;
export const LARGO_OBSERVACION = 300;
export const NOMBRE_PLANTILLA = "plantilla_hallazgos_revisados.xlsx";

const LISTA_MOTIVOS: string[] = Object.values(MOTIVOS);

// ------------------------------------------------------------------ normalizar
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** «Código_Bavaria » → "CODIGO BAVARIA". */
const encabezado = (v: unknown) =>
  sinTildes(String(v ?? ""))
    .toUpperCase()
    .replace(/[_\s.]+/g, " ")
    .trim();

/** El código tal cual, sin espacios ni diferencia de mayúsculas. */
const codigoExacto = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");

/**
 * El código sin ceros a la izquierda: si el Excel lo guardó como número
 * («12067» en vez de «0012067»), igual cruza. Se usa solo cuando el código
 * exacto no aparece en la consulta.
 */
export const codigoParaCruzar = (s: string) => codigoExacto(s).replace(/^0+(?=.)/, "");

/** Para reconocer el motivo aunque cambien tildes, comillas o espacios. */
const motivoParaCruzar = (s: string) =>
  sinTildes(s)
    .toLowerCase()
    .replace(/[«»"“”'‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const MOTIVO_POR_TEXTO = new Map(LISTA_MOTIVOS.map((m) => [motivoParaCruzar(m), m]));

const COLUMNAS = {
  codigo: ["CODIGO BAVARIA", "COD BAVARIA", "CODIGO", "BAVARIA"],
  motivo: ["MOTIVO"],
  fecha: ["FECHA", "FECHA HALLAZGO", "FECHA DEL HALLAZGO", "DIA"],
  observacion: ["OBSERVACION", "OBSERVACIONES", "COMENTARIO", "COMENTARIOS"],
} as const;

// ------------------------------------------------------------------ leer el Excel
/** Una fila con algo escrito, tal como venía y ya interpretada. */
export type FilaLeida = {
  /** Número de la fila en el Excel. */
  fila: number;
  codigo: string | null;
  /** El motivo como venía escrito. */
  motivoTexto: string | null;
  /** El motivo de la lista; null si venía vacío o no se reconoció. */
  motivo: string | null;
  /** La fecha para mostrarla (dd/mm/aaaa si se entendió). */
  fechaTexto: string | null;
  /** 'AAAA-MM-DD'; null si venía vacía o no se entendió. */
  dia: string | null;
  observacion: string | null;
};

export type LecturaRevisados = { hoja: string; filas: FilaLeida[] };

function textoDeCelda(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (v instanceof Date) return null;
  const t = String(v).trim();
  return t || null;
}

/** La fecha de la celda: número de serie de Excel o texto como 09/10/2026. */
function leerDia(v: unknown): { texto: string | null; dia: string | null } {
  if (v === null || v === undefined || v === "") return { texto: null, dia: null };
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y >= 2000 && d.y <= 2200) {
      const dia = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
      return { texto: diaCorto(dia), dia };
    }
    return { texto: String(v), dia: null };
  }
  const texto = String(v).trim();
  if (!texto) return { texto: null, dia: null };
  return { texto, dia: leerFecha(texto)?.dia ?? null };
}

/** Busca la fila de encabezados (entre las 10 primeras) y dónde está cada columna. */
function ubicarColumnas(filas: unknown[][]) {
  for (let i = 0; i < Math.min(10, filas.length); i++) {
    const nombres = (filas[i] ?? []).map(encabezado);
    const donde = (opciones: readonly string[]) => {
      for (const o of opciones) {
        const j = nombres.indexOf(o);
        if (j >= 0) return j;
      }
      return -1;
    };
    const codigo = donde(COLUMNAS.codigo);
    if (codigo >= 0) {
      return {
        filaEncabezado: i,
        codigo,
        motivo: donde(COLUMNAS.motivo),
        fecha: donde(COLUMNAS.fecha),
        observacion: donde(COLUMNAS.observacion),
      };
    }
  }
  return null;
}

/**
 * Lee el Excel. Toma la hoja «Revisados» de la plantilla o, si no está, la
 * primera que tenga la columna CODIGO BAVARIA. Las filas vacías se saltan.
 * Lanza un Error con el mensaje para la pantalla si el archivo no sirve.
 */
export function leerArchivoRevisados(buffer: ArrayBuffer): LecturaRevisados {
  let libro: XLSX.WorkBook;
  try {
    // raw: un CSV no convierte 09/10/2026 en fecha gringa; se lee como texto.
    libro = XLSX.read(buffer, { type: "array", raw: true });
  } catch {
    throw new Error("No se pudo abrir el archivo. Guárdalo como Excel (.xlsx) e intenta de nuevo.");
  }

  const hojas = [...libro.SheetNames].sort(
    (a, b) => Number(encabezado(b) === "REVISADOS") - Number(encabezado(a) === "REVISADOS")
  );

  for (const nombre of hojas) {
    const hoja = libro.Sheets[nombre];
    if (!hoja?.["!ref"]) continue;
    const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: null, raw: true, blankrows: true });
    const cols = ubicarColumnas(filas);
    if (!cols) continue;

    const inicio = XLSX.utils.decode_range(hoja["!ref"]).s.r;
    const celda = (f: unknown[], j: number) => (j >= 0 ? f[j] : null);
    const leidas: FilaLeida[] = [];

    for (let i = cols.filaEncabezado + 1; i < filas.length; i++) {
      const f = filas[i] ?? [];
      const codigo = textoDeCelda(celda(f, cols.codigo));
      const motivoTexto = textoDeCelda(celda(f, cols.motivo));
      const { texto: fechaTexto, dia } = leerDia(celda(f, cols.fecha));
      const observacion = textoDeCelda(celda(f, cols.observacion));
      if (!codigo && !motivoTexto && !fechaTexto && !observacion) continue;

      leidas.push({
        fila: inicio + i + 1,
        codigo,
        motivoTexto,
        motivo: motivoTexto ? (MOTIVO_POR_TEXTO.get(motivoParaCruzar(motivoTexto)) ?? null) : null,
        fechaTexto,
        dia,
        observacion: observacion ? observacion.slice(0, LARGO_OBSERVACION) : null,
      });
      if (leidas.length > MAXIMO_FILAS) {
        throw new Error(
          `El archivo trae más de ${MAXIMO_FILAS.toLocaleString("es-CO")} filas. Pártelo en varios archivos y súbelos uno por uno.`
        );
      }
    }

    if (leidas.length === 0) {
      throw new Error("La hoja no trae ninguna fila llena debajo de los encabezados.");
    }
    return { hoja: nombre, filas: leidas };
  }

  throw new Error(
    "No encontré la columna CODIGO BAVARIA. Usa la plantilla de carga masiva (botón «Descargar plantilla»)."
  );
}

// ------------------------------------------------------------------ cruzar
export type HallazgoAMarcar = {
  clave: string;
  hallazgo: FilaAuditoria;
  /**
   * Cuántas filas de la auditoría son este hallazgo: si la consulta lo trae
   * repetido (mismo formulario, punto, pregunta, respuesta y fecha), se marca
   * una vez y salen todas, como con el botón «Revisado».
   */
  filas: number;
  /** La fila del Excel que lo marcó. */
  filaExcel: number;
  observacion: string | null;
};

export type PdvAMarcar = {
  codigo: string;
  pdv: string;
  consultores: string[];
  /** Motivos de lo que se marca, del más frecuente al menos. */
  motivos: string[];
  /** Hallazgos como los cuenta la auditoría (filas). */
  n: number;
  observaciones: string[];
};

export type FilaNoUsada = {
  fila: number;
  codigo: string | null;
  motivo: string | null;
  fecha: string | null;
  observacion: string | null;
  que: string;
  /** error: hay que corregir la fila; nada: está bien escrita pero no hay qué marcar. */
  tipo: "error" | "nada";
};

export type CruceRevisados = {
  /** Filas con algo escrito. */
  leidas: number;
  /** Lo que se guarda: un registro por hallazgo distinto. */
  marcar: HallazgoAMarcar[];
  /** Cuántos hallazgos salen de la auditoría, contados como ella (filas). */
  hallazgos: number;
  pdv: PdvAMarcar[];
  noUsadas: FilaNoUsada[];
  errores: number;
  sinNada: number;
};

/**
 * Cruza las filas del Excel con los hallazgos de la consulta abierta.
 * filas: toda la consulta (también lo ya revisado, para decir por qué una
 * fila no marca nada). Si dos filas tocan el mismo hallazgo, se queda con la
 * primera y su observación.
 */
export function cruzarRevisados(
  lectura: LecturaRevisados,
  filas: FilaAuditoria[],
  revisados: ReadonlySet<string>,
  claveDe: (f: FilaAuditoria) => string
): CruceRevisados {
  const exactos = new Map<string, FilaAuditoria[]>();
  const sinCeros = new Map<string, FilaAuditoria[]>();
  const agregar = (m: Map<string, FilaAuditoria[]>, c: string, f: FilaAuditoria) => {
    const lista = m.get(c);
    if (lista) lista.push(f);
    else m.set(c, [f]);
  };
  for (const f of filas) {
    if (!f.codigo_bavaria || !codigoExacto(f.codigo_bavaria)) continue;
    agregar(exactos, codigoExacto(f.codigo_bavaria), f);
    agregar(sinCeros, codigoParaCruzar(f.codigo_bavaria), f);
  }

  const tomados = new Map<string, HallazgoAMarcar>();
  const noUsadas: FilaNoUsada[] = [];

  for (const l of lectura.filas) {
    const noUsar = (que: string, tipo: FilaNoUsada["tipo"]) =>
      noUsadas.push({
        fila: l.fila,
        codigo: l.codigo,
        motivo: l.motivoTexto,
        fecha: l.fechaTexto,
        observacion: l.observacion,
        que,
        tipo,
      });

    if (!l.codigo) {
      noUsar("Falta el CODIGO BAVARIA.", "error");
      continue;
    }
    if (l.motivoTexto && !l.motivo) {
      noUsar(`El motivo «${l.motivoTexto}» no es de la lista.`, "error");
      continue;
    }
    if (l.fechaTexto && !l.dia) {
      noUsar(`La fecha «${l.fechaTexto}» no se entiende. Escríbela como 09/10/2026.`, "error");
      continue;
    }

    const delPdv = exactos.get(codigoExacto(l.codigo)) ?? sinCeros.get(codigoParaCruzar(l.codigo)) ?? [];
    if (delPdv.length === 0) {
      noUsar("Ese PDV no tiene hallazgos en la consulta abierta.", "nada");
      continue;
    }

    const cuales = [l.motivo && `de «${l.motivo}»`, l.dia && `del ${diaCorto(l.dia)}`].filter(Boolean).join(" ");
    const coinciden = delPdv.filter((f) => (!l.motivo || f.motivo === l.motivo) && (!l.dia || f.dia === l.dia));
    if (coinciden.length === 0) {
      noUsar(`Ese PDV no tiene hallazgos ${cuales}.`, "nada");
      continue;
    }

    const pendientes = coinciden.filter((f) => !revisados.has(claveDe(f)));
    if (pendientes.length === 0) {
      const n = coinciden.length;
      const sujeto = n === 1 ? "Su hallazgo" : `Sus ${n.toLocaleString("es-CO")} hallazgos`;
      noUsar(`${sujeto}${cuales ? ` ${cuales}` : ""} ${n === 1 ? "ya estaba revisado" : "ya estaban revisados"}.`, "nada");
      continue;
    }

    const nuevos = pendientes.filter((f) => !tomados.has(claveDe(f)));
    if (nuevos.length === 0) {
      const antes = tomados.get(claveDe(pendientes[0]))?.filaExcel;
      noUsar(`Repite lo de la fila ${antes}: no se marca dos veces.`, "nada");
      continue;
    }

    for (const f of nuevos) {
      const clave = claveDe(f);
      const ya = tomados.get(clave);
      if (ya) ya.filas++;
      else tomados.set(clave, { clave, hallazgo: f, filas: 1, filaExcel: l.fila, observacion: l.observacion });
    }
  }

  const marcar = [...tomados.values()];

  // Agrupado por PDV, en el orden del archivo.
  const grupos = new Map<string, HallazgoAMarcar[]>();
  for (const m of marcar) {
    const c = codigoExacto(m.hallazgo.codigo_bavaria ?? "");
    const g = grupos.get(c);
    if (g) g.push(m);
    else grupos.set(c, [m]);
  }
  const pdv: PdvAMarcar[] = [...grupos.values()].map((g) => {
    const conteo = new Map<string, number>();
    for (const m of g) conteo.set(m.hallazgo.motivo, (conteo.get(m.hallazgo.motivo) ?? 0) + m.filas);
    const unicos = (valores: (string | null)[]) => [...new Set(valores.filter((v): v is string => !!v))];
    return {
      codigo: (g[0].hallazgo.codigo_bavaria ?? "").trim(),
      pdv: limpiarTexto(g[0].hallazgo.nombre_personalizado) ?? "PDV sin nombre",
      consultores: unicos(g.map((m) => limpiarTexto(m.hallazgo.nombre_usuario))),
      motivos: [...conteo.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m),
      n: g.reduce((t, m) => t + m.filas, 0),
      observaciones: unicos(g.map((m) => m.observacion)),
    };
  });

  return {
    leidas: lectura.filas.length,
    marcar,
    hallazgos: marcar.reduce((t, m) => t + m.filas, 0),
    pdv,
    noUsadas,
    errores: noUsadas.filter((n) => n.tipo === "error").length,
    sinNada: noUsadas.filter((n) => n.tipo === "nada").length,
  };
}

/** Lo que se manda a guardar de cada hallazgo de la carga. */
export function copiaDeCarga(m: HallazgoAMarcar, archivo: string): CopiaHallazgo {
  return { ...copiaDelHallazgo(m.hallazgo, m.clave), observacion: m.observacion, archivo };
}

// ------------------------------------------------------------------ descargas
function descargar(datos: BlobPart, nombre: string) {
  const url = URL.createObjectURL(
    new Blob([datos], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  );
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Las filas que no se usaron, con las mismas columnas de la plantilla y lo que
 * pasó con cada una: se corrigen ahí mismo y el archivo se puede volver a subir.
 */
export function exportarNoUsadas(noUsadas: FilaNoUsada[], archivo: string) {
  const hoja = XLSX.utils.aoa_to_sheet([
    ["CODIGO BAVARIA", "MOTIVO", "FECHA", "OBSERVACION", "FILA", "QUE PASO"],
    ...noUsadas.map((n) => [n.codigo ?? "", n.motivo ?? "", n.fecha ?? "", n.observacion ?? "", n.fila, n.que]),
  ]);
  hoja["!cols"] = [{ wch: 16 }, { wch: 38 }, { wch: 12 }, { wch: 44 }, { wch: 7 }, { wch: 70 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Revisados");
  XLSX.writeFile(libro, `Observaciones_${archivo.replace(/\.[^.]+$/, "")}.xlsx`);
}

/**
 * La plantilla: hoja de instrucciones, la hoja «Revisados» para llenar (con
 * la lista de motivos, la fecha y el largo de la observación validados) y una
 * hoja oculta con la lista. Se arma aquí para que los motivos sean siempre los
 * mismos de la auditoría. ExcelJS se carga solo al descargarla.
 */
export async function descargarPlantillaRevisados() {
  descargar(await plantillaRevisados(), NOMBRE_PLANTILLA);
}

/** El .xlsx de la plantilla (aparte de la descarga, para poder probarlo). */
export async function plantillaRevisados(): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const libro = new ExcelJS.Workbook();
  const FUENTE = "Aptos Narrow";
  const relleno = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
  const AZUL = relleno("FF00B0F0");
  const AZUL_CLARO = relleno("FFBDE9FA");
  const GRIS = relleno("FFF2F2F2");
  const FILAS = MAXIMO_FILAS;

  // ---------------------------------------------- instrucciones
  const ins = libro.addWorksheet("Instrucciones", { views: [{ showGridLines: false }] });
  ins.columns = [{ width: 2 }, { width: 18 }, { width: 38 }, { width: 14 }, { width: 50 }];
  const t = (
    ref: string,
    valor: string,
    o: { tam?: number; negrita?: boolean; color?: string; fondo?: ReturnType<typeof relleno>; ajustar?: boolean } = {}
  ) => {
    const c = ins.getCell(ref);
    c.value = valor;
    c.font = { name: FUENTE, size: o.tam ?? 11, bold: o.negrita ?? false, color: { argb: o.color ?? "FF000000" } };
    c.alignment = { wrapText: o.ajustar ?? true, vertical: "top" };
    if (o.fondo) c.fill = o.fondo;
  };

  t("B2", "Carga masiva de hallazgos revisados", { tam: 16, negrita: true, ajustar: false });
  t(
    "B3",
    "Marca muchos hallazgos de la auditoría de datos como revisados de una vez. Se llena la hoja «Revisados», una fila por PDV (o por PDV y motivo), y se sube en Auditorías › Datos › Carga masiva.",
    { color: "FF404040" }
  );
  ins.mergeCells("B3:E3");
  ins.getRow(3).height = 34;

  [["B5", "Columna"], ["C5", "Qué poner"], ["D5", "¿Obligatoria?"], ["E5", "Ejemplo"]].forEach(([ref, v]) =>
    t(ref, v, { negrita: true, fondo: GRIS })
  );
  const columnas = [
    ["CODIGO BAVARIA", "El código del PDV, igual que en la auditoría. Se escribe como texto para no perder los ceros.", "Sí", "0012067"],
    ["MOTIVO", "Uno de la lista. Si se deja vacío, se marcan todos los hallazgos pendientes de ese PDV.", "No", MOTIVOS.nacimiento],
    ["FECHA", "El día del hallazgo. Si se deja vacía, sirve cualquier día.", "No", "09/10/2026"],
    ["OBSERVACION", "Lo que se hizo o se habló con el consultor. Queda guardada en Revisados.", "No", "Corregido con el consultor por teléfono"],
  ];
  columnas.forEach(([col, que, oblig, ej], i) => {
    const f = 6 + i;
    t(`B${f}`, col, { negrita: true, fondo: oblig === "Sí" ? AZUL : AZUL_CLARO });
    t(`C${f}`, que);
    t(`D${f}`, oblig);
    t(`E${f}`, ej, { color: "FF404040" });
    ins.getRow(f).height = 46;
  });

  t("B11", "Ejemplos", { tam: 13, negrita: true, ajustar: false });
  t("B12", "CODIGO BAVARIA", { negrita: true, fondo: AZUL });
  t("C12", "MOTIVO", { negrita: true, fondo: AZUL_CLARO });
  t("D12", "FECHA", { negrita: true, fondo: AZUL_CLARO });
  t("E12", "Qué se marca", { negrita: true, fondo: GRIS });
  [
    ["0012067", "", "", "Todos los hallazgos pendientes de ese PDV."],
    ["10884307", MOTIVOS.nacimiento, "", "Solo los de ese motivo, de cualquier día."],
    ["11481641", MOTIVOS.nacimiento, "09/10/2026", "Solo los de ese motivo y ese día."],
  ].forEach(([a, b, c, d], i) => {
    const f = 13 + i;
    t(`B${f}`, a);
    t(`C${f}`, b);
    t(`D${f}`, c);
    t(`E${f}`, d, { color: "FF404040" });
  });

  t("B17", "Bueno saber", { tam: 13, negrita: true, ajustar: false });
  [
    "Solo se marcan hallazgos que salgan en la consulta que tienes abierta y que estén pendientes. Los filtros de la pantalla no cuentan.",
    "Antes de marcar, el panel muestra cuántos hallazgos y PDV se van a marcar, y qué filas no se pudieron usar (código sin hallazgos, motivo que no existe, fecha que no se entiende).",
    `Hasta ${MAXIMO_FILAS.toLocaleString("es-CO")} filas por archivo. Un hallazgo que salga en dos filas se marca una sola vez, con la observación de la primera.`,
    "Todo queda en Auditorías › Revisados con quién lo cargó y cuándo, y se puede devolver a pendientes.",
  ].forEach((nota, i) => {
    const f = 18 + i;
    t(`B${f}`, `• ${nota}`, { color: "FF404040" });
    ins.mergeCells(`B${f}:E${f}`);
    ins.getRow(f).height = 30;
  });

  t("B23", "Motivos que acepta la columna MOTIVO", { tam: 13, negrita: true, ajustar: false });
  LISTA_MOTIVOS.forEach((m, i) => {
    t(`B${24 + i}`, m);
    ins.mergeCells(`B${24 + i}:D${24 + i}`);
  });

  // ---------------------------------------------- la hoja para llenar
  const ws = libro.addWorksheet("Revisados", { views: [{ state: "frozen", ySplit: 1 }] });
  const notas = [
    "Obligatorio. El código del PDV, como sale en la auditoría (con sus ceros a la izquierda).",
    "Opcional. Elige de la lista. Vacío: todos los hallazgos del PDV.",
    "Opcional. Día del hallazgo (dd/mm/aaaa). Vacío: de cualquier día.",
    `Opcional. Queda guardada con la revisión (hasta ${LARGO_OBSERVACION} caracteres).`,
  ];
  ws.columns = [
    { header: "CODIGO BAVARIA", width: 18, style: { numFmt: "@", font: { name: FUENTE, size: 11 } } },
    { header: "MOTIVO", width: 40, style: { font: { name: FUENTE, size: 11 } } },
    { header: "FECHA", width: 14, style: { numFmt: "dd/mm/yyyy", font: { name: FUENTE, size: 11 } } },
    { header: "OBSERVACION", width: 60, style: { font: { name: FUENTE, size: 11 } } },
  ];
  const cabeza = ws.getRow(1);
  cabeza.height = 22;
  cabeza.eachCell((c, j) => {
    c.font = { name: FUENTE, size: 11, bold: true };
    c.fill = j === 1 ? AZUL : AZUL_CLARO;
    c.alignment = { vertical: "middle" };
    c.border = { bottom: { style: "thin", color: { argb: "FF7F7F7F" } } };
    c.note = notas[j - 1];
    c.numFmt = "General";
  });
  ws.autoFilter = "A1:D1";

  // La lista de motivos va en una hoja oculta: así el desplegable no tiene
  // el límite de 255 letras de una lista escrita en la validación.
  const listas = libro.addWorksheet("Listas", { state: "hidden" });
  listas.getCell("A1").value = "MOTIVOS";
  LISTA_MOTIVOS.forEach((m, i) => (listas.getCell(`A${i + 2}`).value = m));

  // ExcelJS sí escribe validaciones por rango, pero sus tipos no lo dicen.
  const validaciones = (ws as unknown as { dataValidations: { add(rango: string, v: unknown): void } }).dataValidations;
  validaciones.add(`B2:B${FILAS + 1}`, {
    type: "list",
    allowBlank: true,
    formulae: [`Listas!$A$2:$A$${LISTA_MOTIVOS.length + 1}`],
    showErrorMessage: true,
    errorTitle: "Motivo",
    error: "Elige un motivo de la lista o deja la celda vacía.",
    showInputMessage: true,
    promptTitle: "Motivo (opcional)",
    prompt: "Vacío: todos los hallazgos del PDV.",
  });
  validaciones.add(`C2:C${FILAS + 1}`, {
    type: "date",
    operator: "between",
    allowBlank: true,
    formulae: [new Date(Date.UTC(2020, 0, 1)), new Date(Date.UTC(2100, 11, 31))],
    showErrorMessage: true,
    errorTitle: "Fecha",
    error: "Escribe una fecha como 09/10/2026.",
  });
  validaciones.add(`D2:D${FILAS + 1}`, {
    type: "textLength",
    operator: "lessThanOrEqual",
    allowBlank: true,
    formulae: [LARGO_OBSERVACION],
    showErrorMessage: true,
    errorTitle: "Observación",
    error: `Máximo ${LARGO_OBSERVACION} caracteres.`,
  });

  // Abre en las instrucciones.
  libro.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 0, visibility: "visible" }];

  return (await libro.xlsx.writeBuffer()) as ArrayBuffer;
}
