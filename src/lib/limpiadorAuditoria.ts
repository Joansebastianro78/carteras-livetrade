/**
 * Limpiador de la auditoría Bavaria (LiveTrade), versión para el navegador.
 *
 * Es el mismo limpiador de herramientas/limpiador_auditoria_bavaria.py,
 * traducido función por función, para correr sobre lo que trae Athena sin
 * servidor de Python. Produce las mismas ocho hojas con los mismos datos:
 * se comparó celda por celda contra el script original con los mismos datos.
 *
 * Si se cambia el script de Python, hay que cambiar esto igual. Los nombres
 * de las funciones siguen a los del script para encontrarlas fácil.
 *
 * Detalles de pandas que se replican a propósito:
 *  - Los empates en value_counts quedan en el orden en que aparecieron.
 *  - groupby y sort_values ordenan texto por punto de código, como Python.
 *  - Las fechas toman el formato de la primera fecha no vacía; una con otro
 *    formato queda vacía (así se comporta pd.to_datetime).
 *  - round(1) redondea a par en el empate, como numpy.
 *  - \s y .strip() usan el mismo conjunto de espacios que Python.
 */

// ----------------------------------------------------------------------------
// CONFIGURACIÓN (la misma del script)
// ----------------------------------------------------------------------------

/**
 * true  = la misma pregunta con distinto número se trata como una sola y se
 *         muestra sin número.
 * false = se conserva el número; solo se unen diferencias de tildes y espacios.
 */
const UNIR_PREGUNTAS_SIN_NUMERO = true;

/** Separador cuando hay varios valores en una misma celda. */
const SEPARADOR = " ; ";

/**
 * Para cambiarle el nombre a una pregunta en la salida.
 * Izquierda: como sale hoy en el Excel. Derecha: como la quieres ver.
 */
const RENOMBRAR_PREGUNTAS: Record<string, string> = {
  // "¿Con qué proveedores?": "Proveedores con los que trabaja",
};

/** Patrón de un usuario normal. Lo que no cumpla se lista en la hoja Notas. */
const PATRON_USUARIO = /^BAV\d+$/;

/**
 * Orden en que se muestran los tipos de línea. Los que no estén aquí salen
 * después, del que más respuestas tiene al que menos.
 */
const ORDEN_TIPO_LINEA = ["Linea base", "Inscripcion avanza", "Linea de seguimiento"];

const DATOS_PDV = ["nombre_personalizado", "departamento", "provincia", "punto_venta_id"] as const;
type DatoPdv = (typeof DATOS_PDV)[number];

const SIN_PREGUNTA = "(Sin pregunta)";
const SIN_CODIGO = "(sin código)";
const SIN_USUARIO = "(sin usuario)";
const SIN_FECHA = "(sin fecha)";
const SIN_LINEA = "(sin tipo de línea)";
const VACIO = "(vacío)";

// ----------------------------------------------------------------------------
// TIPOS
// ----------------------------------------------------------------------------

/** Fecha sin hora, 'AAAA-MM-DD'. En el Excel va como fecha real. */
export type Fecha = { fecha: string };
/** Número que en pandas es float: importa para el ancho de columna ("5.0"). */
export type Flotante = { flotante: number };
export type Celda = string | number | Fecha | Flotante | null;

export type Hoja = {
  nombre: string;
  columnas: string[];
  filas: Celda[][];
  congelar: string;
  altoEncabezado: number;
  colsPregunta: Set<string>;
  anchoPregunta: number;
  filtro: boolean;
};

/** Una fila tal como sale de la consulta: texto o vacío. */
export type FilaEntrada = Partial<Record<string, string | null>>;

export type ResumenLimpieza = {
  respuestas: number;
  usuarios: number;
  codigos: number;
  preguntas: number;
  /** Tipos de línea presentes, en el orden en que salen en el Excel. */
  lineas: string[];
};

type Codigo = string | number;

type Fila = {
  fila_excel: number;
  codigo_bavaria: Codigo;
  nombre_usuario: string;
  pdv: Partial<Record<DatoPdv, Codigo | null>>;
  fecha: string | null;
  /** Línea a la que pertenece la respuesta; nunca vacío. */
  tipo_linea: string;
  /** Posición del tipo de línea en el orden de salida. */
  _olinea: number;
  /** Actividad (formulario) de LiveTrade donde se respondió. */
  actividad_id: Codigo | null;
  pregunta_original: string | null;
  pregunta: string;
  respuesta: string | number | null;
  tipo_respuesta: string;
  _orden: number;
  _fecha_txt: string;
  _resp_txt: string;
};

// ----------------------------------------------------------------------------
// UTILIDADES DE TEXTO (como Python)
// ----------------------------------------------------------------------------

/** Lo que Python considera espacio en \s y en str.strip(). */
const ESP = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const RE_ESPACIOS = new RegExp(`[${ESP}]+`, "gu");
const RE_PUNTAS = new RegExp(`^[${ESP}]+|[${ESP}]+$`, "gu");
const pyStrip = (s: string) => s.replace(RE_PUNTAS, "");

const SOSPECHOSO = /[ÂÃâ]/; // Â Ã â -> señales de tildes dañadas
const NUMERACION = new RegExp(
  `^[${ESP}]*(?:\\p{Nd}+(?:\\.\\p{Nd}+)+[${ESP}]+|\\p{Nd}+[${ESP}]*[.)\\-:][${ESP}]*)`,
  "u"
); // "4." "11. " "2.1 "
const FECHA_TXT = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;
const ENTERO_TXT = /^(0|[1-9]\d{0,14})$/; // "0123" se queda como texto
const ILEGALES_EXCEL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g; // ILLEGAL_CHARACTERS_RE de openpyxl
const MAX_TEXTO_CELDA = 32767; // openpyxl corta ahí, sin avisar, todo texto que escribe

/** Compara texto como Python: por punto de código, no por unidad UTF-16. */
export function cmpPy(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  let i = 0;
  let j = 0;
  while (i < la && j < lb) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(j)!;
    if (ca !== cb) return ca - cb;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  return la - i - (lb - j);
}

/** len() de Python: puntos de código. */
const pyLen = (s: string) => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

const esVacio = (v: string | null | undefined) => v === null || v === undefined || pyStrip(v) === "";

// cp1252: los caracteres que no están en Latin-1 directo.
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Convierte 'Â¿quÃ©' en '¿qué'. Repite por si el daño viene doble. */
export function arreglarTildes(s: string): string {
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    if (!SOSPECHOSO.test(s)) break;

    const crudo: number[] = [];
    let sePuede = true;
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (cp < 0x100) crudo.push(cp); // ASCII, Latin-1 y bytes que cp1252 no define
      else if (cp in CP1252) crudo.push(CP1252[cp]);
      else {
        sePuede = false;
        break;
      }
    }
    if (!sePuede) break;

    let nuevo: string;
    try {
      nuevo = UTF8.decode(Uint8Array.from(crudo));
    } catch {
      break; // no era texto dañado: se deja como está
    }
    if (nuevo === s) break;
    s = nuevo;
  }
  return s;
}

/** Arregla tildes y quita espacios/tabuladores sobrantes. null si queda vacío. */
export function limpiarTexto(v: string | null | undefined): string | null {
  if (esVacio(v)) return null;
  const s = pyStrip(arreglarTildes(v!).replace(RE_ESPACIOS, " "));
  return s || null;
}

/** Clave para comparar preguntas: sin tildes, signos, espacios ni mayúsculas. */
function clave(txt: string): string {
  return txt
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** '11. Del total de ventas...' -> 'Del total de ventas...' */
function sinNumero(txt: string): string {
  const resto = pyStrip(txt.replace(NUMERACION, ""));
  return resto || txt;
}

// ----------------------------------------------------------------------------
// LIMPIEZA DE VALORES
// ----------------------------------------------------------------------------

/** Código bavaria / punto de venta como entero cuando se puede. */
function aCodigo(v: string | null | undefined): Codigo | null {
  if (esVacio(v)) return null;
  const s = limpiarTexto(v);
  if (s === null) return null;
  return ENTERO_TXT.test(s) ? Number(s) : s;
}

/** Respuesta lista para Excel: números como número, fechas como AAAA-MM-DD. */
function respuestaLimpia(v: string | null | undefined): string | number | null {
  const s = limpiarTexto(v);
  if (s === null) return null;
  if (ENTERO_TXT.test(s)) return Number(s);
  const m = s.match(FECHA_TXT);
  if (m && ![m[2], m[3], m[4]].some((x) => Number(x || 0) !== 0)) return m[1];
  return s;
}

function tipoDeRespuesta(v: string | number | null): string {
  if (v === null) return "Sin respuesta";
  if (typeof v === "number") return "Número";
  const minus = v.toLowerCase();
  if (minus.startsWith("http://") || minus.startsWith("https://")) return "Foto";
  if (FECHA_TXT.test(v)) return "Fecha";
  if (v.split("|").some((p) => pyStrip(p).toLowerCase() === "select")) return "Lista con Select";
  return "Texto";
}

// ----------------------------------------------------------------------------
// FECHAS (como pd.to_datetime(..., errors="coerce").dt.normalize())
// ----------------------------------------------------------------------------

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:([ T])(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?)?( UTC)?$/;

function formaDeFecha(m: RegExpMatchArray): string {
  return [m[4] ?? "", m[5] !== undefined, m[7] !== undefined, m[8] !== undefined, m[9] ?? ""].join("|");
}

function diaValido(m: RegExpMatchArray): string | null {
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const diasMes = [31, a % 4 === 0 && (a % 100 !== 0 || a % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (mes < 1 || mes > 12 || d < 1 || d > diasMes[mes - 1]) return null;
  if (m[5] !== undefined && (Number(m[5]) > 23 || Number(m[6]) > 59)) return null;
  if (m[7] !== undefined && Number(m[7]) > 59) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** '05/09/2026': pandas lo adivina como mes/día/año (%m/%d/%Y). */
const BARRAS = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function diaConBarras(v: string): string | null {
  const m = v.match(BARRAS);
  if (!m) return null;
  const dos = (x: string) => x.padStart(2, "0");
  const iso = `${m[3]}-${dos(m[1])}-${dos(m[2])}`.match(ISO);
  return iso ? diaValido(iso) : null;
}

/**
 * pandas adivina el formato con la primera fecha no vacía y lo exige a todas:
 * '2026-09-01' no se lee si la primera traía hora, y si la primera venía como
 * '05/09/2026' solo se leen las que vengan así (como mes/día). Si la primera
 * no tiene formato reconocible, lee cada una por su cuenta.
 */
function leerFechas(valores: (string | null | undefined)[]): (string | null)[] {
  const primera = valores.find((v): v is string => typeof v === "string" && v !== "");

  if (primera !== undefined && BARRAS.test(primera)) {
    return valores.map((v) => (typeof v === "string" ? diaConBarras(v) : null));
  }

  const mPrimera = primera ? primera.match(ISO) : null;
  const forma = mPrimera ? formaDeFecha(mPrimera) : null;

  return valores.map((v) => {
    if (typeof v !== "string" || v === "") return null;
    const m = v.match(ISO);
    if (!m) return null;
    if (forma !== null && formaDeFecha(m) !== forma) return null;
    return diaValido(m);
  });
}

// ----------------------------------------------------------------------------
// NÚMEROS (como Python y numpy)
// ----------------------------------------------------------------------------

/** rint de numpy: redondea a par en el empate exacto. */
function rint(y: number): number {
  const r = Math.round(y);
  return Math.abs(y - Math.trunc(y)) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Series.round(1) de pandas. */
const redondear1 = (x: number) => rint(x * 10) / 10;

/** f"{x:.1f}" de Python: redondeo correcto, a par en el empate exacto. */
function fijo1(x: number): string {
  const cuartos = x * 4; // un empate exacto a 1 decimal solo puede ser ,25 o ,75
  if (Number.isInteger(cuartos) && cuartos % 2 !== 0) {
    const abajo = Math.floor(x * 10);
    return ((abajo % 2 === 0 ? abajo : abajo + 1) / 10).toFixed(1);
  }
  return x.toFixed(1);
}

/** str() de Python, para calcular anchos de columna. */
function pyStr(v: Celda): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if ("fecha" in v) return `${v.fecha} 00:00:00`; // str(Timestamp)
  return Number.isInteger(v.flotante) ? `${v.flotante}.0` : String(v.flotante);
}

const miles = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// ----------------------------------------------------------------------------
// COMPARADORES
// ----------------------------------------------------------------------------

function cmpCodigo(a: Codigo, b: Codigo): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return cmpPy(String(a), String(b));
}

/** NaT al final, como sort_values. */
function cmpFecha(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function ordenarPor<T>(lista: T[], ...cmps: ((a: T, b: T) => number)[]): T[] {
  return [...lista].sort((a, b) => {
    for (const c of cmps) {
      const r = c(a, b);
      if (r !== 0) return r;
    }
    return 0;
  });
}

/** groupby(sort=True): grupos en orden de llave, filas en su orden. */
function agrupar<T, K>(lista: T[], llave: (x: T) => K, cmp: (a: K, b: K) => number, id: (k: K) => string = String) {
  const grupos = new Map<string, { llave: K; filas: T[] }>();
  for (const x of lista) {
    const k = llave(x);
    const ik = id(k);
    let g = grupos.get(ik);
    if (!g) grupos.set(ik, (g = { llave: k, filas: [] }));
    g.filas.push(x);
  }
  return [...grupos.values()].sort((a, b) => cmp(a.llave, b.llave));
}

const unicos = <T,>(xs: T[]) => new Set(xs).size;

/** GroupBy.first(): el primer valor no vacío. */
const primero = <T,>(xs: (T | null | undefined)[]): T | null =>
  xs.find((x) => x !== null && x !== undefined) ?? null;

function unirUnicos(serie: string[]): string {
  const vistos: string[] = [];
  for (const v of serie) {
    if (!esVacio(v) && v !== SIN_FECHA && !vistos.includes(v)) vistos.push(v);
  }
  return vistos.join(SEPARADOR);
}

/** value_counts(): por cantidad, y los empates en el orden en que aparecieron. */
function contar(valores: string[]): [string, number][] {
  const c = new Map<string, number>();
  for (const v of valores) c.set(v, (c.get(v) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
}

// ----------------------------------------------------------------------------
// 1) LEER
// ----------------------------------------------------------------------------

/** Una fila de entrada con su número de fila en el Excel sin limpiar. */
type Crudo = { fila_excel: number; datos: FilaEntrada };

type Lectura = { crudo: Crudo[]; datosPdv: DatoPdv[]; conLinea: boolean; conActividad: boolean };

function leerFilas(entrada: FilaEntrada[]): Lectura {
  const hay = (c: string) => entrada.some((f) => c in f);
  const datosPdv = DATOS_PDV.filter(hay);
  const conLinea = hay("tipo_linea");
  const conActividad = hay("actividad_id");
  const usadas = [
    "codigo_bavaria", "nombre_usuario", "componente_etiqueta", "componente_valor", "fecha",
    ...(conLinea ? ["tipo_linea"] : []),
    ...(conActividad ? ["actividad_id"] : []),
    ...datosPdv,
  ];

  const crudo = entrada
    .map((datos, i) => ({ fila_excel: i + 2, datos })) // fila 1 = encabezado
    .filter((f) => !usadas.every((c) => esVacio(f.datos[c])));
  return { crudo, datosPdv, conLinea, conActividad };
}

// ----------------------------------------------------------------------------
// 2) UNIFICAR PREGUNTAS Y TIPOS DE LÍNEA
// ----------------------------------------------------------------------------

function unificarPreguntas(etiquetas: (string | null)[]): Map<string, string> {
  const conteo = new Map(contar(etiquetas.filter((e): e is string => e !== null)));
  const base = (txt: string) => (UNIR_PREGUNTAS_SIN_NUMERO ? sinNumero(txt) : txt);

  const grupos = new Map<string, string[]>();
  for (const txt of conteo.keys()) {
    const k = clave(base(txt));
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(txt);
  }

  const renombres = new Map<string, string>();
  for (const [viejo, nuevo] of Object.entries(RENOMBRAR_PREGUNTAS)) {
    renombres.set(clave(viejo), nuevo);
    renombres.set(clave(sinNumero(viejo)), nuevo);
  }

  // Prefiere "¿qué...?" sobre "qué...?", luego la más usada, luego la más larga.
  const puntaje = (txt: string): [number, number, number] => {
    const t = base(txt);
    const abre = t.split("¿").length - 1;
    const cierra = t.split("?").length - 1;
    return [abre >= cierra ? 1 : 0, conteo.get(txt)!, pyLen(t)];
  };
  const mayor = (a: number[], b: number[]) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

  const mapa = new Map<string, string>();
  for (const [k, variantes] of grupos) {
    let mejor = variantes[0];
    for (const v of variantes.slice(1)) if (mayor(puntaje(v), puntaje(mejor))) mejor = v; // max(): el primero gana empates
    let nombre = base(mejor);
    if (nombre.split("(").length > nombre.split(")").length) nombre += "…"; // llegó cortada
    nombre = renombres.get(k) ?? nombre;
    for (const txt of variantes) mapa.set(txt, nombre);
  }
  return mapa;
}

/**
 * Devuelve el nombre final de cada tipo de línea y los nombres en orden.
 * Une diferencias de mayúsculas, tildes y espacios ("Línea Base" = "Linea base").
 */
function unificarLineas(lineas: (string | null)[]): { mapa: Map<string, string>; orden: string[] } {
  const conteo = new Map(contar(lineas.filter((l): l is string => l !== null)));

  const grupos = new Map<string, string[]>();
  for (const txt of conteo.keys()) {
    const k = clave(txt);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(txt);
  }

  const mapa = new Map<string, string>();
  const total = new Map<string, number>();
  const llaveDe = new Map<string, string>();
  for (const [k, variantes] of grupos) {
    // La forma más usada; si empatan, la mayor en orden de texto.
    let nombre = variantes[0];
    for (const v of variantes.slice(1)) {
      const dif = conteo.get(v)! - conteo.get(nombre)!;
      if (dif > 0 || (dif === 0 && cmpPy(v, nombre) > 0)) nombre = v;
    }
    total.set(nombre, variantes.reduce((n, t) => n + conteo.get(t)!, 0));
    llaveDe.set(nombre, k);
    for (const txt of variantes) mapa.set(txt, nombre);
  }

  const posicion = new Map(ORDEN_TIPO_LINEA.map((n, i) => [clave(n), i]));
  const lugar = (n: string) => posicion.get(llaveDe.get(n)!) ?? posicion.size;
  const orden = [...total.keys()].sort(
    (a, b) => lugar(a) - lugar(b) || total.get(b)! - total.get(a)! || cmpPy(a, b)
  );
  return { mapa, orden };
}

// ----------------------------------------------------------------------------
// 3) TABLA LIMPIA
// ----------------------------------------------------------------------------

type Info = {
  preguntas: string[];
  etiquetasOriginales: number;
  celdasArregladas: number;
  lineas: string[];
  conLinea: boolean;
  conActividad: boolean;
};

function construirDetalle({ crudo, datosPdv, conLinea, conActividad }: Lectura): { df: Fila[]; info: Info } {
  let celdasArregladas = 0;

  const columnaTexto = (nombre: string) =>
    crudo.map((f) => {
      const antes = f.datos[nombre];
      const despues = limpiarTexto(antes);
      if (typeof antes === "string" && antes !== (despues ?? "")) celdasArregladas++;
      return despues;
    });

  // Código y usuario: nunca vacíos, para que ninguna fila se pierda al agrupar.
  const codigosCrudos = crudo.map((f) => aCodigo(f.datos.codigo_bavaria));
  const todosEnteros = codigosCrudos.every((c) => typeof c === "number");
  const codigos: Codigo[] = todosEnteros
    ? (codigosCrudos as number[])
    : codigosCrudos.map((c) => (c === null ? SIN_CODIGO : String(c)));
  const usuarios = columnaTexto("nombre_usuario").map((u) => u ?? SIN_USUARIO);

  const pdv: Partial<Record<DatoPdv, (Codigo | null)[]>> = {};
  for (const col of datosPdv) {
    pdv[col] = col === "punto_venta_id" ? crudo.map((f) => aCodigo(f.datos[col])) : columnaTexto(col);
  }

  const fechas = leerFechas(crudo.map((f) => f.datos.fecha));

  // Tipo de línea y actividad: a qué formulario pertenece cada respuesta.
  // Nunca queda vacío, para que ninguna fila se pierda al agrupar.
  const lineasTxt = conLinea ? columnaTexto("tipo_linea") : crudo.map(() => null);
  const { mapa: mapaLinea, orden: ordenLinea } = unificarLineas(lineasTxt);
  const tipoLinea = lineasTxt.map((v) => (v !== null ? mapaLinea.get(v)! : SIN_LINEA));
  if (tipoLinea.includes(SIN_LINEA) && !ordenLinea.includes(SIN_LINEA)) ordenLinea.push(SIN_LINEA);
  const lugarLinea = new Map(ordenLinea.map((n, i) => [n, i]));

  const actividades = conActividad ? crudo.map((f) => aCodigo(f.datos.actividad_id)) : null;

  // Pregunta
  const originales = columnaTexto("componente_etiqueta");
  const mapa = unificarPreguntas(originales);
  const preguntas = originales.map((e) => (e !== null ? mapa.get(e)! : SIN_PREGUNTA));

  // Respuesta
  const respuestas = crudo.map((f) => {
    const antes = f.datos.componente_valor;
    const r = respuestaLimpia(antes);
    if (typeof antes === "string" && typeof r === "string" && antes !== r) celdasArregladas++;
    return r;
  });

  // Orden de las preguntas: de la que más respuestas tiene por corregir a la que menos.
  const frec = new Map<string, number>();
  for (const p of preguntas) frec.set(p, (frec.get(p) ?? 0) + 1);
  const orden = [...frec.keys()].sort(
    (a, b) =>
      Number(a === SIN_PREGUNTA) - Number(b === SIN_PREGUNTA) ||
      frec.get(b)! - frec.get(a)! ||
      cmpPy(a, b)
  );
  const posicion = new Map(orden.map((p, i) => [p, i]));

  const df: Fila[] = crudo.map((f, i) => ({
    fila_excel: f.fila_excel,
    codigo_bavaria: codigos[i],
    nombre_usuario: usuarios[i],
    pdv: Object.fromEntries(datosPdv.map((c) => [c, pdv[c]![i]])),
    fecha: fechas[i],
    tipo_linea: tipoLinea[i],
    _olinea: lugarLinea.get(tipoLinea[i])!,
    actividad_id: actividades ? actividades[i] : null,
    pregunta_original: originales[i],
    pregunta: preguntas[i],
    respuesta: respuestas[i],
    tipo_respuesta: tipoDeRespuesta(respuestas[i]),
    _orden: posicion.get(preguntas[i])!,
    _fecha_txt: fechas[i] ?? SIN_FECHA,
    _resp_txt: respuestas[i] === null ? VACIO : String(respuestas[i]),
  }));

  return {
    df,
    info: {
      preguntas: orden,
      etiquetasOriginales: unicos(originales.filter((o) => o !== null)),
      celdasArregladas,
      lineas: ordenLinea,
      conLinea,
      conActividad,
    },
  };
}

// ----------------------------------------------------------------------------
// 4) HOJAS DE SALIDA
// ----------------------------------------------------------------------------

const fechaCelda = (f: string | null): Celda => (f === null ? null : { fecha: f });
const porUsuario = (a: Fila, b: Fila) => cmpPy(a.nombre_usuario, b.nombre_usuario);
const porCodigo = (a: Fila, b: Fila) => cmpCodigo(a.codigo_bavaria, b.codigo_bavaria);
const porLinea = (a: Fila, b: Fila) => a._olinea - b._olinea;
const porFecha = (a: Fila, b: Fila) => cmpFecha(a.fecha, b.fecha);
const porOrden = (a: Fila, b: Fila) => a._orden - b._orden;
const porFila = (a: Fila, b: Fila) => a.fila_excel - b.fila_excel;
const numerico = (a: number, b: number) => a - b;
const minFecha = (xs: (string | null)[]) => xs.filter((x): x is string => x !== null).sort()[0] ?? null;
const maxFecha = (xs: (string | null)[]) => xs.filter((x): x is string => x !== null).sort().at(-1) ?? null;

/** drop_duplicates(keep="first") con varias columnas. */
function sinDuplicados(lista: Fila[], llave: (f: Fila) => unknown[]): Fila[] {
  const vistos = new Set<string>();
  return lista.filter((f) => {
    const k = JSON.stringify(llave(f));
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

/** Actividades distintas del grupo, de menor a mayor: primero los números, después los textos. */
function unirActividades(valores: (Codigo | null)[]): string {
  const unicas = new Map<string, Codigo>();
  for (const v of valores) if (v !== null) unicas.set(JSON.stringify(v), v);
  return [...unicas.values()]
    .sort(
      (a, b) =>
        Number(typeof a === "string") - Number(typeof b === "string") ||
        (typeof a === "number" && typeof b === "number" ? a - b : 0) ||
        cmpPy(String(a), String(b))
    )
    .map(String)
    .join(SEPARADOR);
}

/** Una celda por tipo de línea con la cantidad de respuestas (vacío = ninguna). */
function conteoPorLinea(g: Fila[], lineas: string[]): Celda[] {
  const n = new Map<string, number>();
  for (const f of g) n.set(f.tipo_linea, (n.get(f.tipo_linea) ?? 0) + 1);
  return lineas.map((l) => n.get(l) ?? null);
}

/** "Pregunta (n)" de la que más respuestas tiene a la que menos. */
function preguntasConCantidad(g: Fila[]): string {
  const porPregunta = agrupar(g, (f) => f._orden, numerico).map((p) => ({
    orden: p.llave,
    pregunta: p.filas[0].pregunta,
    n: p.filas.length,
  }));
  porPregunta.sort((a, b) => b.n - a.n || a.orden - b.orden);
  return porPregunta.map((p) => `${p.pregunta} (${p.n})`).join(SEPARADOR);
}

function hojaResumenUsuarios(df: Fila[], lineas: string[]) {
  const columnas = [
    "nombre_usuario", "codigos_bavaria_a_corregir", "respuestas_a_corregir",
    ...lineas, // respuestas por tipo de línea
    "preguntas_distintas", "primera_fecha", "ultima_fecha", "preguntas_a_corregir",
  ];

  const filas = agrupar(df, (f) => f.nombre_usuario, cmpPy).map(({ llave, filas: g }) => [
    llave,
    unicos(g.map((f) => f.codigo_bavaria)),
    g.length,
    ...conteoPorLinea(g, lineas),
    unicos(g.map((f) => f.pregunta)),
    fechaCelda(minFecha(g.map((f) => f.fecha))),
    fechaCelda(maxFecha(g.map((f) => f.fecha))),
    preguntasConCantidad(g),
  ] as Celda[]);

  filas.sort((a, b) => (b[2] as number) - (a[2] as number) || cmpPy(a[0] as string, b[0] as string));
  return { columnas, filas };
}

/** Una fila por usuario + tipo de línea y una columna por pregunta. */
function hojaUsuarioXPregunta(df: Fila[], preguntas: string[]) {
  const totalUsuario = new Map<string, number>();
  for (const f of df) totalUsuario.set(f.nombre_usuario, (totalUsuario.get(f.nombre_usuario) ?? 0) + 1);

  // Primero el usuario con más respuestas por corregir; sus líneas quedan juntas.
  const grupos = agrupar(
    df,
    (f) => f,
    (a, b) =>
      totalUsuario.get(b.nombre_usuario)! - totalUsuario.get(a.nombre_usuario)! ||
      porUsuario(a, b) ||
      porLinea(a, b),
    (f) => JSON.stringify([f.nombre_usuario, f._olinea])
  );

  const filas = grupos.map(({ filas: g }) => {
    const n = new Map<string, number>();
    for (const f of g) n.set(f.pregunta, (n.get(f.pregunta) ?? 0) + 1);
    // Celda vacía = no tiene esa pregunta por corregir.
    return [g[0].nombre_usuario, g[0].tipo_linea, g.length, ...preguntas.map((p) => n.get(p) ?? null)] as Celda[];
  });

  return { columnas: ["nombre_usuario", "tipo_linea", "TOTAL", ...preguntas], filas };
}

/** Una fila por usuario + código bavaria + tipo de línea. */
function hojaUsuarioXCodigo(df: Fila[], datosPdv: DatoPdv[], conActividad: boolean) {
  const d = ordenarPor(df, porUsuario, porCodigo, porLinea, porFecha, porOrden, porFila);
  const llave = (f: Fila) => JSON.stringify([f.nombre_usuario, f.codigo_bavaria, f._olinea]);
  const cmpLlave = (a: Fila, b: Fila) => porUsuario(a, b) || porCodigo(a, b) || porLinea(a, b);

  // "Pregunta = respuesta" (si la misma pregunta se repite, se juntan las respuestas)
  const pr = sinDuplicados(d, (f) => [f.nombre_usuario, f.codigo_bavaria, f._olinea, f.pregunta, f._resp_txt]);
  const listas = new Map<string, string>();
  for (const { filas: g } of agrupar(pr, (f) => f, cmpLlave, llave)) {
    const items = agrupar(g, (f) => f._orden, numerico).map(
      (p) => `${p.filas[0].pregunta} = ${p.filas.map((f) => f._resp_txt).join(" / ")}`
    );
    listas.set(llave(g[0]), items.join(SEPARADOR));
  }

  const filas = agrupar(d, (f) => f, cmpLlave, llave).map(({ filas: g }) => [
    g[0].nombre_usuario,
    g[0].codigo_bavaria,
    g[0].tipo_linea,
    ...datosPdv.map((c) => primero(g.map((f) => f.pdv[c]))),
    ...(conActividad ? [unirActividades(g.map((f) => f.actividad_id))] : []),
    unirUnicos(g.map((f) => f._fecha_txt)),
    g.length,
    unicos(g.map((f) => f.pregunta)),
    listas.get(llave(g[0])) ?? "",
  ] as Celda[]);

  return {
    columnas: [
      "nombre_usuario", "codigo_bavaria", "tipo_linea", ...datosPdv,
      ...(conActividad ? ["actividades"] : []),
      "fechas", "respuestas_a_corregir", "preguntas_distintas", "preguntas_y_respuestas_a_corregir",
    ],
    filas,
  };
}

function hojaResumenPreguntas(df: Fila[], lineas: string[]) {
  const total = df.length;

  const filas = agrupar(df, (f) => f._orden, numerico).map(({ filas: g }) => {
    const top = contar(g.map((f) => f._resp_txt))
      .sort((a, b) => b[1] - a[1] || cmpPy(a[0], b[0]))
      .slice(0, 4); // empates en orden fijo

    // Cada forma en que viene escrita la pregunta y en qué tipo de línea aparece.
    const originales = agrupar(
      g.filter((f) => f.pregunta_original !== null),
      (f) => f.pregunta_original!,
      cmpPy
    ).map(({ llave: txt, filas: sub }) => {
      const en = [...new Set(sub.map((f) => f._olinea))].sort(numerico).map((i) => lineas[i]);
      return `${txt} [${en.join(", ")}]`;
    });

    return [
      g[0].pregunta,
      g.length,
      ...conteoPorLinea(g, lineas), // respuestas por tipo de línea
      unicos(g.map((f) => f.nombre_usuario)),
      unicos(g.map((f) => f.codigo_bavaria)),
      { flotante: redondear1((g.length / total) * 100) },
      top.map(([v, n]) => `${v} (${n})`).join(SEPARADOR),
      originales.join(SEPARADOR),
    ] as Celda[];
  });

  return {
    columnas: [
      "pregunta", "respuestas_a_corregir", ...lineas, "usuarios", "codigos_bavaria",
      "pct_del_total", "respuestas_mas_frecuentes", "como_viene_en_el_archivo",
    ],
    filas,
  };
}

/** Una fila por tipo de línea. */
function hojaResumenLineas(df: Fila[], conActividad: boolean) {
  const total = df.length;

  const filas = agrupar(df, (f) => f._olinea, numerico).map(({ filas: g }) => {
    const fila: Celda[] = [
      g[0].tipo_linea,
      g.length,
      { flotante: redondear1((g.length / total) * 100) },
      unicos(g.map((f) => f.nombre_usuario)),
      unicos(g.map((f) => f.codigo_bavaria)),
      unicos(g.map((f) => f.pregunta)),
      fechaCelda(minFecha(g.map((f) => f.fecha))),
      fechaCelda(maxFecha(g.map((f) => f.fecha))),
    ];

    if (conActividad) {
      // "actividad (n)", ordenadas por su texto: 12602 va antes que 9999.
      const cuenta = new Map<string, { actividad: string; n: number }>();
      for (const f of g) {
        if (f.actividad_id === null) continue;
        const k = JSON.stringify(f.actividad_id);
        const c = cuenta.get(k);
        if (c) c.n++;
        else cuenta.set(k, { actividad: String(f.actividad_id), n: 1 });
      }
      fila.push(
        [...cuenta.values()]
          .sort((a, b) => cmpPy(a.actividad, b.actividad))
          .map((c) => `${c.actividad} (${c.n})`)
          .join(SEPARADOR)
      );
    }

    fila.push(preguntasConCantidad(g));
    return fila;
  });

  return {
    columnas: [
      "tipo_linea", "respuestas_a_corregir", "pct_del_total", "usuarios", "codigos_bavaria",
      "preguntas_distintas", "primera_fecha", "ultima_fecha",
      ...(conActividad ? ["actividades"] : []),
      "preguntas_a_corregir",
    ],
    filas,
  };
}

/** Una fila por código bavaria + tipo de línea y una columna por pregunta. */
function hojaHorizontal(df: Fila[], preguntas: string[], datosPdv: DatoPdv[], conActividad: boolean) {
  const d = ordenarPor(df, porCodigo, porLinea, porFecha, porUsuario, porFila);
  const llave = (f: Fila) => JSON.stringify([f.codigo_bavaria, f._olinea]);

  // Si el mismo código tiene varias respuestas a la misma pregunta, van todas.
  const celdas = new Map<string, Map<string, string>>();
  for (const f of sinDuplicados(d, (x) => [x.codigo_bavaria, x._olinea, x.pregunta, x._resp_txt])) {
    const id = llave(f);
    if (!celdas.has(id)) celdas.set(id, new Map());
    const fila = celdas.get(id)!;
    fila.set(f.pregunta, fila.has(f.pregunta) ? fila.get(f.pregunta)! + SEPARADOR + f._resp_txt : f._resp_txt);
  }
  const recortar = (s: string) => {
    const puntos = Array.from(s);
    return puntos.length <= 32000 ? s : puntos.slice(0, 32000).join("") + " …"; // límite de celda de Excel
  };

  const filas = agrupar(d, (f) => f, (a, b) => porCodigo(a, b) || porLinea(a, b), llave).map(({ filas: g }) => {
    const respuestas = celdas.get(llave(g[0]))!;
    return [
      g[0].codigo_bavaria,
      g[0].tipo_linea,
      ...datosPdv.map((c) => primero(g.map((f) => f.pdv[c]))),
      unirUnicos(g.map((f) => f.nombre_usuario)),
      unirUnicos(g.map((f) => f._fecha_txt)),
      ...(conActividad ? [unirActividades(g.map((f) => f.actividad_id))] : []),
      g.length,
      ...preguntas.map((p) => (respuestas.has(p) ? recortar(respuestas.get(p)!) : null)),
    ] as Celda[];
  });

  return {
    columnas: [
      "codigo_bavaria", "tipo_linea", ...datosPdv, "usuarios", "fechas",
      ...(conActividad ? ["actividades"] : []),
      "respuestas_a_corregir", ...preguntas,
    ],
    filas,
  };
}

function hojaDetalle(df: Fila[], datosPdv: DatoPdv[], conActividad: boolean) {
  const d = ordenarPor(df, porCodigo, porLinea, porFecha, porUsuario, porOrden, porFila);
  return {
    columnas: [
      "codigo_bavaria", "tipo_linea", ...(conActividad ? ["actividad_id"] : []), ...datosPdv,
      "nombre_usuario", "fecha", "pregunta", "respuesta", "tipo_respuesta", "pregunta_original", "fila_excel",
    ],
    filas: d.map((f) => [
      f.codigo_bavaria,
      f.tipo_linea,
      ...(conActividad ? [f.actividad_id] : []),
      ...datosPdv.map((c) => f.pdv[c] ?? null),
      f.nombre_usuario,
      fechaCelda(f.fecha),
      f.pregunta,
      f.respuesta,
      f.tipo_respuesta,
      f.pregunta_original,
      f.fila_excel,
    ] as Celda[]),
  };
}

function hojaNotas(origen: string, generado: string, df: Fila[], info: Info, datosPdv: DatoPdv[]) {
  const total = df.length;
  const pct = (n: number) => (total ? `${miles(n)} (${fijo1((n / total) * 100)} %)` : "0");

  const sinResp = df.filter((f) => f.tipo_respuesta === "Sin respuesta").length;
  const sinFecha = df.filter((f) => f.fecha === null).length;
  const sinPreg = df.filter((f) => f.pregunta === SIN_PREGUNTA).length;
  const sinLinea = df.filter((f) => f.tipo_linea === SIN_LINEA).length;
  const raros = [...new Set(df.map((f) => f.nombre_usuario))]
    .filter((u) => !PATRON_USUARIO.test(u))
    .sort(cmpPy);

  const vistos = new Set<string>();
  let dup = 0;
  for (const f of df) {
    const k = JSON.stringify([
      f.codigo_bavaria, f.nombre_usuario, f._fecha_txt, f.tipo_linea, f.pregunta_original, f._resp_txt,
      ...(info.conActividad ? [f.actividad_id] : []),
    ]);
    if (vistos.has(k)) dup++;
    else vistos.add(k);
  }

  /** Cuántos grupos tienen más de un valor distinto: groupby(...)[col].nunique() > 1. */
  const conVarios = (filas: Fila[], grupo: (f: Fila) => unknown, valor: (f: Fila) => string) => {
    const porGrupo = new Map<string, Set<string>>();
    for (const f of filas) {
      const k = JSON.stringify(grupo(f));
      if (!porGrupo.has(k)) porGrupo.set(k, new Set());
      porGrupo.get(k)!.add(valor(f));
    }
    return [...porGrupo.values()].filter((s) => s.size > 1).length;
  };

  const conLinea = df.filter((f) => f.tipo_linea !== SIN_LINEA);
  const porLineaN = agrupar(df, (f) => f._olinea, numerico).map(
    ({ filas: g }): [string, string] => [g[0].tipo_linea, pct(g.length)]
  );

  // str(c) not in str(n): un nombre vacío es None, y str(None) es "None".
  let fuera: string[] = [];
  if (datosPdv.includes("nombre_personalizado")) {
    fuera = sinDuplicados(df, (f) => [f.codigo_bavaria])
      .filter((f) => !String(f.pdv.nombre_personalizado ?? "None").includes(String(f.codigo_bavaria)))
      .map((f) => String(f.codigo_bavaria));
  }

  const listaCorta = (items: string[], maximo = 15) => {
    if (items.length === 0) return "Ninguno";
    const extra = items.length > maximo ? ` … y ${items.length - maximo} más` : "";
    return items.slice(0, maximo).join(", ") + extra;
  };

  const fechas = df.map((f) => f.fecha);
  const filas: [string, string | number][] = [
    ["Archivo de origen", origen],
    ["Generado", generado],
    ["", ""],
    ["CONTENIDO", ""],
    ["Respuestas por corregir (filas del archivo)", total],
    ["Usuarios", unicos(df.map((f) => f.nombre_usuario))],
    ["Códigos bavaria", unicos(df.map((f) => f.codigo_bavaria))],
    ["Preguntas distintas (ya unificadas)", info.preguntas.filter((p) => p !== SIN_PREGUNTA).length],
    ["Formas distintas en que venían escritas las preguntas", info.etiquetasOriginales],
    ["Fecha mínima", minFecha(fechas) ?? ""],
    ["Fecha máxima", maxFecha(fechas) ?? ""],
    ["", ""],
    ["TIPO DE LÍNEA", info.conLinea ? "" : "El archivo no trae la columna tipo_linea."],
    ...porLineaN,
    ["", ""],
    ["TIPO DE RESPUESTA", ""],
    ...contar(df.map((f) => f.tipo_respuesta)).map(([t, n]): [string, string] => [t, pct(n)]),
    ["", ""],
    ["LIMPIEZA", ""],
    ["Celdas con tildes o espacios corregidos", info.celdasArregladas],
    ["", ""],
    ["PARA REVISAR", ""],
    ["Filas sin respuesta", sinResp],
    ["Filas sin fecha", sinFecha],
    ["Filas sin pregunta", sinPreg],
    ["Filas sin tipo de línea", sinLinea],
    ["Filas repetidas idénticas (se conservan)", dup],
    ["Códigos con más de un usuario", conVarios(df, (f) => f.codigo_bavaria, (f) => f.nombre_usuario)],
    ["Códigos con más de un tipo de línea", conVarios(conLinea, (f) => f.codigo_bavaria, (f) => f.tipo_linea)],
    [
      "Preguntas que aparecen en más de un tipo de línea",
      conVarios(conLinea, (f) => f.pregunta, (f) => f.tipo_linea),
    ],
    [
      "Código + tipo de línea + pregunta con más de una respuesta distinta",
      conVarios(df, (f) => [f.codigo_bavaria, f.tipo_linea, f.pregunta], (f) => f._resp_txt),
    ],
    ["Usuarios que no tienen formato BAV###", listaCorta(raros)],
    ["Códigos que no aparecen en el nombre del punto", listaCorta(fuera)],
    ["", ""],
    ["CÓMO LEER", ""],
    ["Cada fila del archivo original", "es una respuesta por corregir."],
    ["tipo_linea", "línea a la que pertenece la respuesta; es la que dice en qué formulario se corrige."],
    [
      "Un código con varios tipos de línea",
      "sale en una fila por cada tipo de línea en Usuario_x_Codigo y Preguntas_Horizontal.",
    ],
    [
      "Columnas con nombre de tipo de línea",
      "en Resumen_Usuarios y Resumen_Preguntas: cuántas respuestas " +
        "por corregir hay en esa línea (vacío = ninguna).",
    ],
    [SIN_LINEA, "la fila no traía tipo de línea en el archivo original."],
    [
      "Preguntas",
      UNIR_PREGUNTAS_SIN_NUMERO
        ? "van sin número porque la misma pregunta cambia de número según el formulario; " +
          "el texto original está en Detalle_por_Codigo (pregunta_original) y, con su tipo de " +
          "línea, en Resumen_Preguntas (como_viene_en_el_archivo)."
        : "conservan el número con el que vienen en el archivo.",
    ],
    ["Pregunta terminada en '…'", "llegó cortada en el archivo original."],
    [VACIO, "la fila no traía respuesta."],
    [
      "Varias respuestas en una celda",
      `separadas por '${SEPARADOR.trim()}': el código tiene más de una ` +
        "respuesta a esa pregunta en la misma línea (otra fecha u otro usuario).",
    ],
  ];
  return { columnas: ["Concepto", "Valor"], filas: filas as Celda[][] };
}

// ----------------------------------------------------------------------------
// PRINCIPAL
// ----------------------------------------------------------------------------

/**
 * Limpia las filas de la auditoría y arma las ocho hojas del script.
 * `fila_excel` es la fila de cada respuesta en el Excel sin limpiar (la 1 es
 * el encabezado), en el mismo orden en que llegaron.
 */
export function limpiarAuditoria(
  entrada: FilaEntrada[],
  origen: string,
  ahora: Date = new Date()
): { hojas: Hoja[]; resumen: ResumenLimpieza } | null {
  const lectura = leerFilas(entrada);
  if (lectura.crudo.length === 0) return null; // "El archivo no tiene filas con datos."

  const { df, info } = construirDetalle(lectura);
  const { datosPdv } = lectura;
  const { preguntas, lineas, conActividad } = info;

  const dos = (n: number) => String(n).padStart(2, "0");
  const generado = `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())} ${dos(ahora.getHours())}:${dos(ahora.getMinutes())}`;

  const hoja = (
    nombre: string,
    datos: { columnas: string[]; filas: Celda[][] },
    o: Partial<Pick<Hoja, "congelar" | "altoEncabezado" | "anchoPregunta" | "filtro">> & { colsPregunta?: string[] } = {}
  ): Hoja => ({
    nombre,
    ...datos,
    congelar: o.congelar ?? "A2",
    altoEncabezado: o.altoEncabezado ?? 30,
    colsPregunta: new Set(o.colsPregunta ?? []),
    anchoPregunta: o.anchoPregunta ?? 26,
    filtro: o.filtro ?? true,
  });

  // Columnas que quedan fijas al desplazarse: las llaves y el nombre del punto.
  const fijasHorizontal = 2 + Number(datosPdv.includes("nombre_personalizado"));

  const hojas = [
    hoja("Resumen_Usuarios", hojaResumenUsuarios(df, lineas), { congelar: "B2" }),
    hoja("Usuario_x_Pregunta", hojaUsuarioXPregunta(df, preguntas), {
      congelar: "D2", altoEncabezado: 95, colsPregunta: preguntas, anchoPregunta: 17,
    }),
    hoja("Usuario_x_Codigo", hojaUsuarioXCodigo(df, datosPdv, conActividad), { congelar: "D2" }),
    hoja("Resumen_Preguntas", hojaResumenPreguntas(df, lineas), { congelar: "B2" }),
    hoja("Resumen_Tipo_Linea", hojaResumenLineas(df, conActividad), { congelar: "B2" }),
    hoja("Preguntas_Horizontal", hojaHorizontal(df, preguntas, datosPdv, conActividad), {
      congelar: `${letra(fijasHorizontal + 1)}2`, altoEncabezado: 80, colsPregunta: preguntas,
    }),
    hoja("Detalle_por_Codigo", hojaDetalle(df, datosPdv, conActividad), { congelar: "C2" }),
    hoja("Notas", hojaNotas(origen, generado, df, info, datosPdv), { filtro: false }),
  ];

  return {
    hojas,
    resumen: {
      respuestas: df.length,
      usuarios: unicos(df.map((f) => f.nombre_usuario)),
      codigos: unicos(df.map((f) => f.codigo_bavaria)),
      preguntas: preguntas.length,
      lineas,
    },
  };
}

// ----------------------------------------------------------------------------
// 5) ESCRIBIR EL EXCEL
// ----------------------------------------------------------------------------

/** Anchos fijos por nombre de columna; el resto se calcula. */
const ANCHOS: Record<string, number> = {
  preguntas_a_corregir: 100, preguntas_y_respuestas_a_corregir: 100,
  respuestas_mas_frecuentes: 60, como_viene_en_el_archivo: 70,
  nombre_personalizado: 40, pregunta: 60, pregunta_original: 60, respuesta: 34,
  fechas: 24, usuarios: 18, Concepto: 62, Valor: 90,
  tipo_linea: 22,
};

export function anchoDeColumna(hoja: Hoja, i: number): number {
  const col = hoja.columnas[i];
  if (col in ANCHOS) return ANCHOS[col];
  if (hoja.colsPregunta.has(col)) return hoja.anchoPregunta;
  let largo = pyLen(col);
  for (const fila of hoja.filas.slice(0, 300)) {
    const v = fila[i];
    if (v === null || (typeof v === "string" && esVacio(v))) continue;
    largo = Math.max(largo, pyLen(pyStr(v)));
  }
  return Math.min(Math.max(largo + 2, 10), 42);
}

function letra(n: number): string {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** 'AAAA-MM-DD' → número de serie de Excel (en UTC, para no correr el día). */
function serial(fecha: string): number {
  const [a, m, d] = fecha.split("-").map(Number);
  return (Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/**
 * Arma el .xlsx con el mismo formato del script: encabezado azul oscuro en
 * blanco y negrilla, paneles congelados, anchos, filtro y fechas reales.
 * ExcelJS se carga aquí y no antes: pesa, y solo hace falta al descargar.
 */
export async function escribirExcel(hojas: Hoja[]): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const libro = new ExcelJS.Workbook();

  for (const h of hojas) {
    const [, colCongelada, filaCongelada] = h.congelar.match(/^([A-Z]+)(\d+)$/)!;
    const xSplit = colCongelada.split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
    const ws = libro.addWorksheet(h.nombre, {
      views: [{ state: "frozen", xSplit, ySplit: Number(filaCongelada) - 1, topLeftCell: h.congelar }],
    });

    ws.columns = h.columnas.map((_, i) => ({ width: anchoDeColumna(h, i) }));

    const encabezado = ws.addRow(h.columnas);
    encabezado.height = h.altoEncabezado;
    encabezado.eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
      c.alignment = { vertical: "middle", wrapText: true };
    });

    for (const fila of h.filas) {
      const valores = fila.map((v) => {
        if (v === null) return null;
        if (typeof v === "string") {
          const t = v.replace(ILEGALES_EXCEL, "");
          return t.length <= MAX_TEXTO_CELDA ? t : Array.from(t).slice(0, MAX_TEXTO_CELDA).join("");
        }
        if (typeof v === "number") return v;
        if ("fecha" in v) return serial(v.fecha);
        return v.flotante;
      });
      const r = ws.addRow(valores);
      fila.forEach((v, j) => {
        if (v !== null && typeof v === "object" && "fecha" in v) r.getCell(j + 1).numFmt = "yyyy-mm-dd";
      });
    }

    if (h.filtro && h.columnas.length) {
      ws.autoFilter = `A1:${letra(h.columnas.length)}${h.filas.length + 1}`;
    }
  }

  return (await libro.xlsx.writeBuffer()) as ArrayBuffer;
}
