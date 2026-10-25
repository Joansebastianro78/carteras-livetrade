/**
 * Auditoría con query, vista de datos: para las queries que no traen fotos
 * (respuestas de formularios, cobertura, ventas...). Reconocer qué columnas
 * sirven para agrupar y filtrar, y armar el Excel con lo que se ve.
 *
 * Es lo que la auditoría de datos hace con sus hallazgos, pero sin reglas
 * propias: trabaja con las columnas que traiga la query.
 */
import * as XLSX from "xlsx";
import { leerFecha } from "./fechas";
import { ROLES, type Mapeo } from "./queriesFotos";

export type FilaDatos = (string | null)[];

export const ES_ENLACE = /^https?:\/\//i;

/** Una columna con más valores distintos que esto no sirve para agrupar (serían ids, nombres...). */
const MAX_AGRUPAR = 200;
/** Y con más que esto, tampoco como lista desplegable de filtro. */
const MAX_FILTRO = 80;

const sinTildes = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export type ColumnaUtil = {
  nombre: string;
  indice: number;
  /** Valores distintos (sin contar los vacíos). */
  valores: number;
  /** Es una de las columnas que la pantalla ya usa: consultor, PDV, código, fecha o foto. */
  esRol: boolean;
};

/**
 * Las columnas que sirven para agrupar o filtrar: entre 2 y 200 valores
 * distintos y sin enlaces. Las repetidas (dos columnas con el mismo nombre)
 * cuentan una sola vez.
 */
export function columnasUtiles(columnas: string[], crudas: FilaDatos[], mapeo: Mapeo): ColumnaUtil[] {
  const roles = new Set(ROLES.map((r) => mapeo[r]).filter((c): c is string => c !== null));
  const salida: ColumnaUtil[] = [];
  columnas.forEach((nombre, i) => {
    if (columnas.indexOf(nombre) !== i) return;
    const distintos = new Set<string>();
    let conEnlaces = false;
    for (const f of crudas) {
      const v = (f[i] ?? "").trim();
      if (!v) continue;
      if (ES_ENLACE.test(v)) {
        conEnlaces = true;
        break;
      }
      distintos.add(v);
      if (distintos.size > MAX_AGRUPAR) break;
    }
    if (conEnlaces || distintos.size < 2 || distintos.size > MAX_AGRUPAR) return;
    salida.push({ nombre, indice: i, valores: distintos.size, esRol: roles.has(nombre) });
  });
  return salida;
}

/** Por qué columna se agrupa de entrada: la que más se parece a una pregunta, un motivo o un tipo. */
export function agruparPorDefecto(utiles: ColumnaUtil[]): string | null {
  const libres = utiles.filter((c) => !c.esRol);
  const preferidas = [
    /pregunta|etiqueta|motivo|hallazgo|regla/,
    /tipo|categoria|estado|resultado|linea/,
    /departamento|ciudad|zona|cadena|region|provincia/,
  ];
  for (const patron of preferidas) {
    const c = libres.find((x) => patron.test(sinTildes(x.nombre)));
    if (c) return c.nombre;
  }
  return (libres[0] ?? utiles[0])?.nombre ?? null;
}

/** Hasta tres columnas que sirven de lista desplegable de filtro (departamento, ciudad, zona...). */
export function columnasDeFiltro(utiles: ColumnaUtil[], agrupada: string | null): ColumnaUtil[] {
  return utiles.filter((c) => !c.esRol && c.nombre !== agrupada && c.valores <= MAX_FILTRO).slice(0, 3);
}

/** «componente_etiqueta» → «Componente etiqueta» */
export function nombreBonito(columna: string): string {
  const t = columna.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ------------------------------------------------------------------ Excel
/** «Respuestas (Bogotá)» → Respuestas_Bogota */
function paraArchivo(nombre: string): string {
  return (
    nombre
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "query"
  );
}

/**
 * El Excel de la vista de datos: todas las columnas de la query, con sus
 * nombres y en su orden, solo con las filas que se están viendo. La fecha
 * queda como fecha de Excel y los enlaces como enlaces. Lo demás va como
 * texto, para que una cédula o un celular no pierdan ceros ni salgan en
 * notación científica.
 */
export function exportarDatos(
  columnas: string[],
  filas: FilaDatos[],
  columnaFecha: number,
  nombre: string,
  sufijo: string
) {
  const formatoFecha: (string | null)[] = filas.map(() => null);

  const datos = filas.map((f, r) =>
    columnas.map((_, c) => {
      const v = f[c] ?? null;
      if (v === null || v === "") return null;
      if (c === columnaFecha) {
        const fecha = leerFecha(v);
        if (fecha) {
          const [a, m, d] = fecha.dia.split("-").map(Number);
          formatoFecha[r] = fecha.hora ? "dd/mm/yyyy hh:mm" : "dd/mm/yyyy";
          // En UTC a propósito: con la hora local, la fecha se corre un día en Colombia.
          return (Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000 + fecha.segundos / 86_400;
        }
      }
      return v;
    })
  );

  const hoja = XLSX.utils.aoa_to_sheet([columnas, ...datos]);

  filas.forEach((f, r) => {
    columnas.forEach((_, c) => {
      const celda = hoja[XLSX.utils.encode_cell({ r: r + 1, c })];
      if (!celda) return;
      if (c === columnaFecha && celda.t === "n" && formatoFecha[r]) celda.z = formatoFecha[r];
      const v = f[c];
      if (typeof v === "string" && ES_ENLACE.test(v.trim()) && v.length <= 2_000) {
        celda.l = { Target: v.trim(), Tooltip: "Abrir el enlace" };
      }
    });
  });

  const muestra = filas.slice(0, 200);
  hoja["!cols"] = columnas.map((nombreCol, c) => {
    if (c === columnaFecha) return { wch: 17 };
    const largo = Math.max(nombreCol.length, ...muestra.map((f) => (f[c] ?? "").length));
    return { wch: Math.min(Math.max(largo + 2, 10), 45) };
  });
  hoja["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(datos.length, 1), c: columnas.length - 1 } }),
  };

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Datos");
  XLSX.writeFile(libro, `Auditoria_query_${paraArchivo(nombre)}_${sufijo}.xlsx`);
}
