/**
 * Auditoría con query, en el navegador: reconocer qué columna del resultado
 * es la foto, la fecha, el PDV, el consultor y el código; armar las visitas
 * para la galería (la misma de la auditoría de imágenes) y el Excel con todas
 * las columnas de la query.
 */
import * as XLSX from "xlsx";
import { leerFecha } from "./fechas";
import { armarFila, fotosDe, type EstadoRevision, type FilaImagen, type Revision } from "./imagenesAuditoria";
import { MAPEO_VACIO, ROLES, type Mapeo } from "./queriesFotos";

/** Una visita de la query: lo que usa la galería y la fila tal como llegó. */
export type FilaQuery = FilaImagen & { original: (string | null)[] };

/** Con estas filas basta para reconocer las columnas. */
const MUESTRA = 500;

const sinTildes = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const CONSULTOR = /usuario|consultor|mercader|vendedor|asesor|promotor|impulsador|auditor|user/;

/** Parece un código o un id, no un nombre. */
const PARECE_CODIGO = /(^|_)(cod|codigo|id)(_|$)|^cod|_id$/;

type Perfil = { nombre: string; llenas: number; enlaces: number; fechas: number };

/** Cuántas celdas de la muestra tienen algo, cuántas un enlace y cuántas una fecha. */
function perfilar(columnas: string[], filas: (string | null)[][]): Perfil[] {
  const muestra = filas.slice(0, MUESTRA);
  return columnas.map((nombre, i) => {
    let llenas = 0;
    let enlaces = 0;
    let fechas = 0;
    for (const f of muestra) {
      const v = (f[i] ?? "").trim();
      if (!v) continue;
      llenas++;
      if (fotosDe(v).length > 0) enlaces++;
      else if (leerFecha(v)) fechas++;
    }
    return { nombre, llenas, enlaces, fechas };
  });
}

/**
 * Qué columna parece ser cada cosa. Primero por el contenido (la foto es la
 * que trae enlaces, la fecha la que trae fechas) y el nombre ayuda a
 * desempatar; el PDV, el consultor y el código, por el nombre. Una columna no
 * se usa para dos cosas.
 */
export function detectarColumnas(columnas: string[], filas: (string | null)[][]): Mapeo {
  const perfiles = perfilar(columnas, filas);
  const usadas = new Set<string>();
  const mapeo: Mapeo = { ...MAPEO_VACIO };

  const elegir = (puntaje: (p: Perfil, n: string) => number) => {
    let mejor: string | null = null;
    let tope = 0;
    for (const p of perfiles) {
      if (usadas.has(p.nombre)) continue;
      const v = puntaje(p, sinTildes(p.nombre));
      if (v > tope) {
        tope = v;
        mejor = p.nombre;
      }
    }
    if (mejor !== null) usadas.add(mejor);
    return mejor;
  };

  mapeo.foto = elegir((p, n) =>
    p.enlaces === 0 ? 0 : p.enlaces / Math.max(p.llenas, 1) + (/foto|imagen|img|photo|evidencia|url|link/.test(n) ? 1 : 0)
  );
  mapeo.fecha = elegir((p, n) => {
    const parte = p.llenas === 0 ? 0 : p.fechas / p.llenas;
    return parte < 0.5 ? 0 : parte + (/fecha|date|hora|time|dia/.test(n) ? 1 : 0);
  });
  mapeo.pdv = elegir((p, n) => {
    // nombre_personalizado es el nombre del PDV en las tablas de LiveTrade.
    if (n === "nombre_pdv" || n === "nombre_personalizado") return 100;
    if (/^(pdv|nombre_punto|nombre_punto_venta|punto_venta|nombre_establecimiento|razon_social)$/.test(n)) return 90;
    if (/pdv|punto|tienda|establec|negocio|cliente|local/.test(n)) {
      return PARECE_CODIGO.test(n) ? 5 : 50 + (n.includes("nombre") ? 10 : 0);
    }
    // Otro «nombre_…» que no es del consultor: lo más seguro es que sea el del punto.
    return n.startsWith("nombre") && !CONSULTOR.test(n) ? 20 : 0;
  });
  mapeo.consultor = elegir((p, n) => {
    if (n === "nombre_usuario") return 100;
    if (!CONSULTOR.test(n)) return 0;
    return PARECE_CODIGO.test(n) ? 5 : 50 + (n.includes("nombre") ? 10 : 0);
  });
  mapeo.codigo = elegir((_p, n) => {
    if (n === "cod_personalizado") return 100;
    if (/cod|codigo/.test(n)) return 50;
    return /^(id_pdv|pdv_id)$/.test(n) ? 40 : 0;
  });
  return mapeo;
}

/**
 * Las columnas con que se muestra la query: lo que se eligió en la pantalla,
 * si no lo guardado con la query, y si no lo reconocido. Lo que no existe en
 * el resultado de ahora (cambió la query) no cuenta.
 */
export function resolverMapeo(
  columnas: string[],
  detectado: Mapeo,
  guardado: Partial<Mapeo> | null,
  elegido: Partial<Mapeo>
): Mapeo {
  const sirve = (c: string | null | undefined) => c === null || (typeof c === "string" && columnas.includes(c));
  const mapeo: Mapeo = { ...MAPEO_VACIO };
  for (const rol of ROLES) {
    if (rol in elegido && sirve(elegido[rol])) mapeo[rol] = elegido[rol] ?? null;
    else if (guardado && rol in guardado && sirve(guardado[rol])) mapeo[rol] = guardado[rol] ?? null;
    else mapeo[rol] = detectado[rol];
  }
  return mapeo;
}

/** Las visitas para la galería, con las columnas elegidas. */
export function filasDeQuery(columnas: string[], crudas: (string | null)[][], mapeo: Mapeo): FilaQuery[] {
  const pos = (c: string | null) => (c === null ? -1 : columnas.indexOf(c));
  const i = { foto: pos(mapeo.foto), fecha: pos(mapeo.fecha), pdv: pos(mapeo.pdv), consultor: pos(mapeo.consultor), codigo: pos(mapeo.codigo) };
  return crudas.map((v) => {
    const valor = (k: number) => (k < 0 ? null : (v[k] ?? null));
    const fila = armarFila({
      nombre_pdv: valor(i.pdv),
      nombre_usuario: valor(i.consultor),
      cod_personalizado: valor(i.codigo),
      foto_visita_inicio: valor(i.foto),
      fecha_inicio: valor(i.fecha),
    }) as FilaQuery;
    fila.original = v;
    return fila;
  });
}

/** Un filtro de la galería con los valores de una columna de la query. */
export type FiltroColumna<F> = { id: string; nombre: string; valorDe: (f: F) => string | null };

/** Columnas con más valores distintos que esto no sirven de filtro (serían nombres, códigos…). */
const MAX_VALORES_FILTRO = 80;

/**
 * Las columnas de la query que sirven para filtrar: las que no son foto,
 * fecha, PDV, consultor ni código, y tienen entre 2 y 80 valores distintos
 * (departamento, ciudad, zona, cadena…). Hasta cuatro.
 */
export function filtrosDeQuery(columnas: string[], crudas: (string | null)[][], mapeo: Mapeo): FiltroColumna<FilaQuery>[] {
  const usadas = new Set(ROLES.map((r) => mapeo[r]).filter((c): c is string => c !== null));
  const salida: FiltroColumna<FilaQuery>[] = [];
  columnas.forEach((nombre, i) => {
    if (salida.length >= 4 || usadas.has(nombre) || columnas.indexOf(nombre) !== i) return;
    const valores = new Set<string>();
    let enlaces = 0;
    for (const f of crudas) {
      const v = (f[i] ?? "").trim();
      if (!v) continue;
      if (/^https?:\/\//i.test(v)) enlaces++;
      valores.add(v);
      if (valores.size > MAX_VALORES_FILTRO) return;
    }
    if (valores.size < 2 || enlaces > 0) return;
    salida.push({
      id: nombre,
      nombre: (nombre.charAt(0).toUpperCase() + nombre.slice(1)).replace(/_/g, " "),
      valorDe: (f) => (f.original[i] ?? "").trim() || null,
    });
  });
  return salida;
}

/** Las demás columnas de la visita, para verlas junto a la foto. */
export function detalleDeQuery(columnas: string[], mapeo: Mapeo) {
  const usadas = new Set(ROLES.map((r) => mapeo[r]).filter((c): c is string => c !== null));
  const otras = columnas.map((c, i) => [c, i] as const).filter(([c]) => !usadas.has(c));
  return (f: FilaQuery): [string, string][] =>
    otras
      .map(([c, i]): [string, string] => [c, (f.original[i] ?? "").trim()])
      .filter(([, v]) => v !== "")
      .slice(0, 15)
      .map(([c, v]) => [c, v.length > 300 ? `${v.slice(0, 300)}…` : v]);
}

// ------------------------------------------------------------------ Excel
const MAX_ENLACES = 65_000;
const MAX_LARGO_ENLACE = 2_000;

const NOMBRE_REVISION: Record<EstadoRevision, string> = {
  correcta: "Correcta",
  revisar: "Para revisar",
};

/** «Fotos de cierre (Bogotá)» → Fotos_de_cierre_Bogota */
function paraArchivo(nombre: string): string {
  return (
    nombre
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "query"
  );
}

/**
 * El Excel de la Auditoría con query: todas las columnas de la query, con sus
 * nombres y en su orden, y al final la revisión de cada foto y quién la hizo.
 * La foto queda como enlace y la fecha como fecha de Excel, como en la
 * auditoría de imágenes.
 */
export function exportadorDeQuery(columnas: string[], mapeo: Mapeo, nombre: string) {
  return (
    filas: FilaQuery[],
    sufijo: string,
    revisionDe: (f: FilaQuery) => Revision | null,
    repetidaDe?: (f: FilaQuery) => { grupo: number; ia: string | null } | null
  ) => {
    const colFecha = mapeo.fecha === null ? -1 : columnas.indexOf(mapeo.fecha);
    const colFoto = mapeo.foto === null ? -1 : columnas.indexOf(mapeo.foto);
    const formatoFecha: (string | null)[] = filas.map(() => null);

    const datos = filas.map((f, r) =>
      columnas.map((_, c) => {
        const v = f.original[c] ?? null;
        if (v === null || v === "") return null;
        if (c === colFecha) {
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
    // Si se buscaron repetidas, dos columnas más: el grupo y lo que dijo la IA.
    const conRepetidas = repetidaDe !== undefined && filas.some((f) => repetidaDe(f) !== null);
    const revisiones = filas.map((f) => {
      const r = revisionDe(f);
      const base: (string | number | null)[] = r ? [NOMBRE_REVISION[r.estado], r.revisado_por] : [null, null];
      if (conRepetidas) {
        const x = repetidaDe!(f);
        base.push(x ? x.grupo : null, x?.ia ?? null);
      }
      return base;
    });
    const extra = conRepetidas ? ["revision", "revisado_por", "grupo_repetida", "ia_repetida"] : ["revision", "revisado_por"];

    const hoja = XLSX.utils.aoa_to_sheet([[...columnas, ...extra], ...datos.map((d, i) => [...d, ...revisiones[i]])]);

    if (colFecha >= 0) {
      formatoFecha.forEach((formato, r) => {
        if (!formato) return;
        const celda = hoja[XLSX.utils.encode_cell({ r: r + 1, c: colFecha })];
        if (celda && celda.t === "n") celda.z = formato;
      });
    }
    if (colFoto >= 0 && filas.length <= MAX_ENLACES) {
      filas.forEach((f, r) => {
        if (f.fotos.length !== 1 || f.fotos[0].length > MAX_LARGO_ENLACE) return;
        const celda = hoja[XLSX.utils.encode_cell({ r: r + 1, c: colFoto })];
        if (celda) celda.l = { Target: f.fotos[0], Tooltip: "Abrir la foto" };
      });
    }

    const muestra = filas.slice(0, 200);
    hoja["!cols"] = [
      ...columnas.map((nombreCol, c) => {
        if (c === colFoto) return { wch: 70 };
        if (c === colFecha) return { wch: 17 };
        const largo = Math.max(nombreCol.length, ...muestra.map((f) => (f.original[c] ?? "").length));
        return { wch: Math.min(Math.max(largo + 2, 10), 40) };
      }),
      { wch: 14 },
      { wch: 26 },
      ...(conRepetidas ? [{ wch: 15 }, { wch: 15 }] : []),
    ];
    hoja["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: datos.length, c: columnas.length + extra.length - 1 } }),
    };

    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Fotos");
    XLSX.writeFile(libro, `Auditoria_query_${paraArchivo(nombre)}_${sufijo}.xlsx`);
  };
}
