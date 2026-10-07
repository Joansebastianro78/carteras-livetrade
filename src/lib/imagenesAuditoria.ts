/**
 * Auditoría de imágenes: la foto con la que cada consultor inició la visita.
 * Tipos, lectura de las columnas de foto y fecha, y descarga en Excel. Lo usa
 * el navegador; la consulta está en lib/consultaImagenes.ts.
 */
import * as XLSX from "xlsx";

/** Columnas de la consulta, en su orden y con su nombre en Athena. */
export const COLUMNAS_IMAGENES = [
  "nombre_pdv",
  "nombre_usuario",
  "cod_personalizado",
  "foto_visita_inicio",
  "fecha_inicio",
] as const;

type ColumnaImagen = (typeof COLUMNAS_IMAGENES)[number];

/**
 * con_foto      la visita trae al menos un enlace de foto
 * sin_foto      la columna viene vacía
 * no_es_enlace  trae algo que no es una dirección http(s): un nombre de
 *               archivo, una ruta interna... No se puede mostrar.
 */
export type EstadoFoto = "con_foto" | "sin_foto" | "no_es_enlace";

export type FilaImagen = Record<ColumnaImagen, string | null> & {
  /** Enlaces de foto encontrados en foto_visita_inicio. */
  fotos: string[];
  estado: EstadoFoto;
  /** Día de fecha_inicio, 'AAAA-MM-DD'; null si no trae fecha o no se entiende. */
  dia: string | null;
  /** Hora de fecha_inicio, 'HH:MM'; null si la fecha viene sin hora. */
  hora: string | null;
  /** Día y segundo de la visita, para ordenar; vacío si no trae fecha. */
  orden: string;
};

// ------------------------------------------------------------------ fotos
/**
 * Enlaces de foto de una celda. Normalmente es uno; si vienen varios, se
 * separan por espacios, saltos de línea o "|", que es como LiveTrade junta
 * varios valores. No se parte por comas: hay direcciones que las llevan.
 *
 * Solo se aceptan direcciones http y https. Cualquier otra cosa (incluido
 * "javascript:...") se descarta: estos valores terminan en un <img> y en un
 * enlace, y vienen de datos que escribe otra aplicación.
 */
export function fotosDe(valor: string | null | undefined): string[] {
  if (!valor) return [];
  const enlaces: string[] = [];
  for (const parte of valor.split(/[\s|]+/)) {
    if (!/^https?:\/\//i.test(parte)) continue;
    try {
      const url = new URL(parte);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    } catch {
      continue;
    }
    // Se guarda tal cual llegó: un enlace firmado deja de servir si se reescribe.
    if (!enlaces.includes(parte)) enlaces.push(parte);
  }
  return enlaces;
}

// ------------------------------------------------------------------ fechas
const FECHA_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
const FECHA_DMA = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

export type FechaLeida = { dia: string; hora: string | null; segundos: number };

/**
 * Lee fecha_inicio. Athena la entrega como '2026-09-12 14:05:33.000' si la
 * columna es de fecha y hora, o '2026-09-12' si es solo fecha; también se
 * acepta día/mes/año por si viene como texto.
 *
 * La fecha se toma tal como está escrita, sin convertir zona horaria: no hay
 * cómo saber desde aquí en qué zona la guardó el origen.
 */
export function leerFecha(valor: string | null | undefined): FechaLeida | null {
  const texto = (valor ?? "").trim();
  let a: number, m: number, d: number;
  let partes = texto.match(FECHA_ISO);
  if (partes) {
    [a, m, d] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  } else if ((partes = texto.match(FECHA_DMA))) {
    [d, m, a] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
    if (m > 12 && d <= 12) [d, m] = [m, d]; // venía mes/día
  } else {
    return null;
  }

  // 30 de febrero y similares no son fechas.
  const real = new Date(Date.UTC(a, m - 1, d));
  if (real.getUTCFullYear() !== a || real.getUTCMonth() !== m - 1 || real.getUTCDate() !== d) {
    return null;
  }

  const dos = (n: number) => String(n).padStart(2, "0");
  const dia = `${String(a).padStart(4, "0")}-${dos(m)}-${dos(d)}`;
  if (partes[4] === undefined) return { dia, hora: null, segundos: 0 };

  const [h, min, s] = [Number(partes[4]), Number(partes[5]), Number(partes[6] ?? 0)];
  if (h > 23 || min > 59 || s > 59) return { dia, hora: null, segundos: 0 };
  return { dia, hora: `${dos(h)}:${dos(min)}`, segundos: h * 3600 + min * 60 + s };
}

/** '2026-09-12' → '12/09/2026' */
export function diaCorto(dia: string): string {
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

/** Arma las filas a partir de lo que entrega Athena, buscando cada columna por nombre. */
export function filasDeImagenes(columnas: string[], filas: (string | null)[][]): FilaImagen[] {
  const posicion = new Map(columnas.map((c, i) => [c.toLowerCase(), i]));
  return filas.map((f) => {
    const fila = {} as FilaImagen;
    for (const c of COLUMNAS_IMAGENES) {
      const i = posicion.get(c);
      fila[c] = i === undefined ? null : (f[i] ?? null);
    }
    fila.fotos = fotosDe(fila.foto_visita_inicio);
    fila.estado =
      fila.fotos.length > 0
        ? "con_foto"
        : (fila.foto_visita_inicio ?? "").trim() === ""
          ? "sin_foto"
          : "no_es_enlace";
    const fecha = leerFecha(fila.fecha_inicio);
    fila.dia = fecha?.dia ?? null;
    fila.hora = fecha?.hora ?? null;
    fila.orden = fecha ? `${fecha.dia} ${String(fecha.segundos).padStart(5, "0")}` : "";
    return fila;
  });
}

/**
 * Las visitas de la más reciente a la más antigua; las que no traen fecha, al
 * final. Athena las entrega sin orden. Devuelve una lista nueva.
 */
export function ordenarPorFecha(filas: FilaImagen[]): FilaImagen[] {
  return [...filas].sort((a, b) => (a.orden === b.orden ? 0 : a.orden < b.orden ? 1 : -1));
}

// ------------------------------------------------------------------ Excel
/** Excel admite hasta 66.530 enlaces por hoja y 2.079 caracteres por enlace. */
const MAX_ENLACES = 65_000;
const MAX_LARGO_ENLACE = 2_000;

const ANCHOS: Record<ColumnaImagen, number> = {
  nombre_pdv: 40,
  nombre_usuario: 18,
  cod_personalizado: 18,
  foto_visita_inicio: 70,
  fecha_inicio: 17,
};

/**
 * Descarga de la auditoría de imágenes: las columnas de la consulta, con sus
 * mismos nombres. La foto queda como enlace para abrirla con un clic y la
 * fecha como fecha de Excel, para poder filtrarla y ordenarla.
 *
 * `sufijo` va en el nombre del archivo: el rango de fechas, o el día de hoy.
 */
export function exportarImagenes(filas: FilaImagen[], sufijo: string) {
  /** Formato de la celda de fecha de cada fila; null si no quedó como fecha. */
  const formatoFecha: (string | null)[] = filas.map(() => null);

  const datos = filas.map((f, i) =>
    COLUMNAS_IMAGENES.map((c) => {
      const v = f[c];
      if (v === null || v === "") return null;
      if (c === "fecha_inicio") {
        const fecha = leerFecha(v);
        if (fecha) {
          const [a, m, d] = fecha.dia.split("-").map(Number);
          formatoFecha[i] = fecha.hora ? "dd/mm/yyyy hh:mm" : "dd/mm/yyyy";
          // En UTC a propósito: con la hora local, la fecha se corre un día en Colombia.
          return (Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000 + fecha.segundos / 86_400;
        }
      }
      // Todo lo demás como texto: los códigos conservan sus ceros.
      return v;
    })
  );

  const hoja = XLSX.utils.aoa_to_sheet([[...COLUMNAS_IMAGENES], ...datos]);

  const colFecha = COLUMNAS_IMAGENES.indexOf("fecha_inicio");
  formatoFecha.forEach((formato, i) => {
    if (!formato) return;
    const celda = hoja[XLSX.utils.encode_cell({ r: i + 1, c: colFecha })];
    if (celda && celda.t === "n") celda.z = formato;
  });

  const colFoto = COLUMNAS_IMAGENES.indexOf("foto_visita_inicio");
  if (filas.length <= MAX_ENLACES) {
    filas.forEach((f, i) => {
      // Con varias fotos en la celda no hay un único destino para el enlace.
      if (f.fotos.length !== 1 || f.fotos[0].length > MAX_LARGO_ENLACE) return;
      const celda = hoja[XLSX.utils.encode_cell({ r: i + 1, c: colFoto })];
      if (celda) celda.l = { Target: f.fotos[0], Tooltip: "Abrir la foto" };
    });
  }

  hoja["!cols"] = COLUMNAS_IMAGENES.map((c) => ({ wch: ANCHOS[c] }));
  hoja["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: datos.length, c: COLUMNAS_IMAGENES.length - 1 },
    }),
  };

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Fotos");
  XLSX.writeFile(libro, `Auditoria_imagenes_${sufijo}.xlsx`);
}
