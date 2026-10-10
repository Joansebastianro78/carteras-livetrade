/**
 * Fechas de las consultas de auditoría y el rango «Desde / Hasta» con que se
 * filtran. Lo usa el navegador; lo comparten la auditoría de datos y la de
 * imágenes.
 */

// ------------------------------------------------------------------ lectura
const FECHA_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
const FECHA_DMA = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

export type FechaLeida = {
  /** 'AAAA-MM-DD' */
  dia: string;
  /** 'HH:MM'; null si la fecha viene sin hora. */
  hora: string | null;
  /** Segundos desde la medianoche; 0 si viene sin hora. */
  segundos: number;
};

/**
 * Lee una fecha de la consulta. Llega como '2026-09-12 14:05:33.000' si la
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

/**
 * Para mostrar: '12/09/2026 14:05'. Si no se entiende como fecha, el texto
 * tal cual; null si viene vacío.
 */
export function fechaLegible(valor: string | null | undefined): string | null {
  const fecha = leerFecha(valor);
  if (fecha) return `${diaCorto(fecha.dia)}${fecha.hora ? ` ${fecha.hora}` : ""}`;
  return (valor ?? "").trim() || null;
}

// ------------------------------------------------------------------ rango
/** Rango elegido en pantalla. Cada extremo es 'AAAA-MM-DD', o vacío si no se puso. */
export type Rango = { desde: string; hasta: string };

export const SIN_RANGO: Rango = { desde: "", hasta: "" };

export const hayRango = (r: Rango) => r.desde !== "" || r.hasta !== "";

/** «Desde» quedó después de «Hasta»: no entra nada. */
export const rangoAlReves = (r: Rango) => r.desde !== "" && r.hasta !== "" && r.desde > r.hasta;

/**
 * Si un día cae en el rango, con los dos extremos incluidos. Sin rango entra
 * todo; con rango, lo que no trae fecha queda fuera.
 */
export function dentroDelRango(dia: string | null, r: Rango): boolean {
  if (!hayRango(r)) return true;
  return dia !== null && (r.desde === "" || dia >= r.desde) && (r.hasta === "" || dia <= r.hasta);
}

/** "entre el 01/09/2026 y el 15/09/2026", "desde el…", "hasta el…"; vacío sin rango. */
export function textoRango(r: Rango): string {
  if (r.desde && r.hasta) {
    return r.desde === r.hasta
      ? `el ${diaCorto(r.desde)}`
      : `entre el ${diaCorto(r.desde)} y el ${diaCorto(r.hasta)}`;
  }
  if (r.desde) return `desde el ${diaCorto(r.desde)}`;
  if (r.hasta) return `hasta el ${diaCorto(r.hasta)}`;
  return "";
}

/** Para el nombre de un archivo: el rango, o el día de hoy si no hay rango. */
export function sufijoRango(r: Rango): string {
  if (r.desde && r.hasta) return `${r.desde}_a_${r.hasta}`;
  if (r.desde) return `desde_${r.desde}`;
  if (r.hasta) return `hasta_${r.hasta}`;
  // El día de aquí, no el de Greenwich: desde las 7 p. m. de Colombia ya sería mañana.
  return diaDe(new Date());
}

export type ResumenFechas = {
  /** Primer y último día con datos, 'AAAA-MM-DD'; vacíos si ninguna fila trae fecha. */
  primera: string;
  ultima: string;
  /** Filas sin fecha, o con una que no se entiende. */
  sinFecha: number;
  /** Un ejemplo de fecha que no se pudo leer; vacío si no hay ninguna. */
  ilegible: string;
};

/** `dia` da el día ya leído de cada fila; `escrito`, lo que traía la columna. */
export function resumirFechas<T>(
  filas: T[],
  dia: (fila: T) => string | null,
  escrito: (fila: T) => string | null
): ResumenFechas {
  let primera = "";
  let ultima = "";
  let sinFecha = 0;
  let ilegible = "";
  for (const f of filas) {
    const d = dia(f);
    if (d === null) {
      sinFecha++;
      if (!ilegible) ilegible = (escrito(f) ?? "").trim();
    } else {
      if (!primera || d < primera) primera = d;
      if (!ultima || d > ultima) ultima = d;
    }
  }
  return { primera, ultima, sinFecha, ilegible };
}

// ------------------------------------------------------------------ rangos rápidos
const dos = (n: number) => String(n).padStart(2, "0");

/** 'AAAA-MM-DD' de una fecha, en la hora del navegador (Colombia, para el equipo). */
export function diaDe(fecha: Date): string {
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

export type Atajo = "todo" | "hoy" | "siete" | "mes" | "personalizado";

/** Los rangos de los botones rápidos, calculados para hoy. */
export function rangoDeAtajo(atajo: Exclude<Atajo, "personalizado">, hoy = new Date()): Rango {
  if (atajo === "todo") return SIN_RANGO;
  const fin = diaDe(hoy);
  if (atajo === "hoy") return { desde: fin, hasta: fin };
  if (atajo === "siete") {
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 6);
    return { desde: diaDe(inicio), hasta: fin };
  }
  return { desde: diaDe(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: fin };
}

/** Cuál botón rápido corresponde al rango puesto; "personalizado" si ninguno. */
export function atajoDeRango(r: Rango, hoy = new Date()): Atajo {
  if (!hayRango(r)) return "todo";
  for (const a of ["hoy", "siete", "mes"] as const) {
    const otro = rangoDeAtajo(a, hoy);
    if (otro.desde === r.desde && otro.hasta === r.hasta) return a;
  }
  return "personalizado";
}

// ------------------------------------------------------------------ para leer
const ZONA = "America/Bogota";

/** "Jueves, 10 de septiembre" (con el año si no es el actual). */
export function diaLargo(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d));
  const texto = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(a !== new Date().getFullYear() ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(fecha);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** El momento dado en hora de Colombia: "Viernes, 9 de octubre" y "7:15 p. m.". */
export function fechaYHora(fecha: Date): { dia: string; hora: string } {
  const dia = new Intl.DateTimeFormat("es-CO", {
    timeZone: ZONA,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(fecha);
  const hora = new Intl.DateTimeFormat("es-CO", {
    timeZone: ZONA,
    hour: "numeric",
    minute: "2-digit",
  }).format(fecha);
  return { dia: dia.charAt(0).toUpperCase() + dia.slice(1), hora };
}

/** "hoy, 8:42 a. m.", "ayer, 4:10 p. m." o "7 de octubre, 3:15 p. m.", en hora de Colombia. */
export function cuando(iso: string | null | undefined): string {
  if (!iso) return "";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  const dia = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const hora = new Intl.DateTimeFormat("es-CO", { timeZone: ZONA, hour: "numeric", minute: "2-digit" }).format(fecha);
  const ese = dia(fecha);
  if (ese === dia(new Date())) return `hoy, ${hora}`;
  if (ese === dia(new Date(Date.now() - 86_400_000))) return `ayer, ${hora}`;
  const texto = new Intl.DateTimeFormat("es-CO", {
    timeZone: ZONA,
    day: "numeric",
    month: "long",
    ...(fecha.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  }).format(fecha);
  return `${texto}, ${hora}`;
}
