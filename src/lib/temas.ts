/**
 * Temas de temporada.
 *
 * Las fechas viven aquí, en código, y no en la base: son las mismas todos los
 * años y así no hay que acordarse de moverlas cada diciembre. Lo que sí vive
 * en la base es qué temas están encendidos y en qué modo está el sitio, que
 * es lo que el administrador cambia desde el panel.
 *
 * Este archivo no importa nada de Supabase a propósito: lo usan tanto el
 * servidor como los componentes del navegador.
 */

export type IdTema =
  | "halloween"
  | "velitas"
  | "navidad"
  | "anio-nuevo"
  | "amor-amistad"
  | "carnaval"
  | "san-valentin"
  | "mujer"
  | "tierra"
  | "nino"
  | "madre"
  | "padre"
  | "independencia"
  | "cometas"
  | "cafe"
  | "futbol"
  | "celebracion";

/** [mes, día], con el mes empezando en 1. */
export type Fecha = [number, number];

/** Un rango de días; incluye los dos extremos. */
export type Rango = { desde: Fecha; hasta: Fecha };

type Comun = {
  id: IdTema;
  nombre: string;
  /** Qué se ve en pantalla, para que el panel lo explique sin adivinar. */
  decoracion: string;
};

/**
 * Cuándo sale solo cada tema. Hay tres clases:
 *  - fechas fijas (desde/hasta): las mismas todos los años;
 *  - fechas que cambian cada año (Carnaval, Día de la Madre): `regla` lo dice
 *    en palabras y `calcular` da el rango de ese año;
 *  - sin fecha: nunca sale solo; se pone con «Dejar uno fijo» (un partido de
 *    la Selección, el aniversario de la empresa).
 */
export type Tema =
  | (Comun & Rango)
  | (Comun & { regla: string; calcular: (anio: number) => Rango })
  | (Comun & { sinFecha: true });

// ------------------------------------------------- fechas que se mueven
// Se cuenta en UTC para que la zona horaria del servidor no corra un día.

const DIA_MS = 86_400_000;

function fechaUtc(anio: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(anio, mes - 1, dia));
}

function sumarDias(fecha: Date, dias: number): Date {
  return new Date(fecha.getTime() + dias * DIA_MS);
}

function aFecha(fecha: Date): Fecha {
  return [fecha.getUTCMonth() + 1, fecha.getUTCDate()];
}

/** Domingo de Pascua del calendario gregoriano (algoritmo de Meeus). */
export function domingoDePascua(anio: number): Date {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return fechaUtc(anio, mes, dia);
}

/** El n-ésimo día de la semana de un mes (0 = domingo): el segundo domingo de mayo. */
function enesimoDelMes(anio: number, mes: number, diaSemana: number, n: number): Date {
  const primero = fechaUtc(anio, mes, 1);
  const salto = (diaSemana - primero.getUTCDay() + 7) % 7;
  return sumarDias(primero, salto + (n - 1) * 7);
}

/** El último día de la semana de un mes (0 = domingo): el último sábado de abril. */
function ultimoDelMes(anio: number, mes: number, diaSemana: number): Date {
  const ultimo = fechaUtc(anio, mes + 1, 0);
  const salto = (ultimo.getUTCDay() - diaSemana + 7) % 7;
  return sumarDias(ultimo, -salto);
}

/** De `antes` días antes de la fecha hasta la fecha misma. */
function terminaEl(fecha: Date, antes: number): Rango {
  return { desde: aFecha(sumarDias(fecha, -antes)), hasta: aFecha(fecha) };
}

/**
 * El orden importa: gana el primero que coincida con la fecha. Por eso los
 * rangos cortos y más específicos (las velitas, el año nuevo) van antes que
 * navidad, que los cubre a ambos. Lo mismo con los temas nuevos: el Día de la
 * Tierra va antes que el del Niño, que algunos años lo alcanza, y el de la
 * Mujer antes que el Carnaval. El Carnaval sí va antes que San Valentín: hay
 * años en que coinciden (2026) y en Colombia pesa más el Carnaval.
 */
export const TEMAS: Tema[] = [
  {
    id: "velitas",
    nombre: "Día de las Velitas",
    decoracion: "Farolitos en las esquinas y luces cálidas que suben.",
    desde: [12, 7],
    hasta: [12, 8],
  },
  {
    id: "anio-nuevo",
    nombre: "Año nuevo",
    decoracion: "Papelitos de colores cayendo.",
    desde: [12, 27],
    hasta: [1, 6],
  },
  {
    id: "navidad",
    nombre: "Navidad",
    decoracion: "Nieve cayendo y una tira de luces arriba.",
    desde: [12, 1],
    hasta: [12, 26],
  },
  {
    id: "halloween",
    nombre: "Halloween",
    decoracion: "Telarañas en las esquinas, una araña colgando y una calabaza.",
    desde: [10, 24],
    hasta: [11, 2],
  },
  {
    id: "amor-amistad",
    nombre: "Amor y amistad",
    decoracion: "Corazones subiendo despacio.",
    desde: [9, 14],
    hasta: [9, 21],
  },
  {
    id: "mujer",
    nombre: "Día de la Mujer",
    decoracion: "Pétalos morados que caen meciéndose y una rama florecida en la esquina.",
    desde: [3, 7],
    hasta: [3, 8],
  },
  {
    id: "carnaval",
    nombre: "Carnaval de Barranquilla",
    decoracion: "Serpentinas colgando, confeti redondo y un antifaz en la esquina.",
    regla: "Del sábado al martes de Carnaval",
    // El Miércoles de Ceniza cae 46 días antes del domingo de Pascua.
    calcular: (anio) => terminaEl(sumarDias(domingoDePascua(anio), -47), 3),
  },
  {
    id: "san-valentin",
    nombre: "San Valentín",
    decoracion: "Una guirnalda de corazones colgando arriba.",
    desde: [2, 13],
    hasta: [2, 14],
  },
  {
    id: "tierra",
    nombre: "Día de la Tierra",
    decoracion: "Brotes que crecen abajo y hojas que caen meciéndose.",
    desde: [4, 22],
    hasta: [4, 22],
  },
  {
    id: "nino",
    nombre: "Día del Niño",
    decoracion: "Burbujas de jabón subiendo.",
    regla: "Del jueves al último sábado de abril",
    calcular: (anio) => terminaEl(ultimoDelMes(anio, 4, 6), 2),
  },
  {
    id: "madre",
    nombre: "Día de la Madre",
    decoracion: "Mariposas que cruzan la pantalla y tulipanes en las esquinas.",
    regla: "Del jueves al segundo domingo de mayo",
    calcular: (anio) => terminaEl(enesimoDelMes(anio, 5, 0, 2), 3),
  },
  {
    id: "padre",
    nombre: "Día del Padre",
    decoracion: "Una guirnalda de corbatas que se mecen.",
    regla: "Del jueves al tercer domingo de junio",
    calcular: (anio) => terminaEl(enesimoDelMes(anio, 6, 0, 3), 3),
  },
  {
    id: "independencia",
    nombre: "Independencia de Colombia",
    decoracion: "Banderines amarillo, azul y rojo, y fuegos artificiales a los lados.",
    desde: [7, 18],
    hasta: [7, 20],
  },
  {
    id: "cometas",
    nombre: "Mes de las cometas",
    decoracion: "Cometas con cola que se mecen arriba y nubes que pasan.",
    desde: [8, 1],
    hasta: [8, 31],
  },
  {
    id: "cafe",
    nombre: "Día Internacional del Café",
    decoracion: "Una taza humeando en la esquina y granos de café cayendo.",
    desde: [10, 1],
    hasta: [10, 1],
  },
  {
    id: "futbol",
    nombre: "Fútbol",
    decoracion: "Una franja tricolor arriba y balones que pasan rebotando abajo. Para los partidos de la Selección.",
    sinFecha: true,
  },
  {
    id: "celebracion",
    nombre: "Celebración",
    decoracion: "Globos de colores subiendo. Para el aniversario de la empresa o un cierre de campaña.",
    sinFecha: true,
  },
];

export function buscarTema(id: string | null | undefined): Tema | null {
  return TEMAS.find((t) => t.id === id) ?? null;
}

export type ModoTema = "automatico" | "apagado" | "fijo";

export type EstadoTema = {
  modo: ModoTema;
  /** Tema forzado cuando el modo es "fijo". */
  temaFijo: IdTema | null;
  /** Temas que el administrador apagó: el modo automático los salta. */
  apagados: IdTema[];
};

export const ESTADO_TEMA_POR_DEFECTO: EstadoTema = {
  modo: "automatico",
  temaFijo: null,
  apagados: [],
};

/** Año, mes y día en hora de Colombia, sin importar dónde corra el servidor. */
export function fechaEnBogota(ahora: Date = new Date()): { anio: number; mes: number; dia: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ahora);

  const valor = (tipo: string) =>
    Number(partes.find((p) => p.type === tipo)?.value ?? "1");

  return { anio: valor("year"), mes: valor("month"), dia: valor("day") };
}

/** Día y mes en hora de Colombia, sin importar dónde corra el servidor. */
export function hoyEnBogota(ahora: Date = new Date()): [number, number] {
  const { mes, dia } = fechaEnBogota(ahora);
  return [mes, dia];
}

/** Los días del tema en ese año, o null si no tiene fecha. */
export function rangoDelTema(tema: Tema, anio: number): Rango | null {
  if ("sinFecha" in tema) return null;
  if ("calcular" in tema) return tema.calcular(anio);
  return { desde: tema.desde, hasta: tema.hasta };
}

/** ¿La fecha [mes, día] de ese año cae dentro del rango del tema? */
export function enTemporada(
  tema: Tema,
  [mes, dia]: [number, number],
  anio: number = fechaEnBogota().anio
): boolean {
  const rango = rangoDelTema(tema, anio);
  if (!rango) return false;

  const punto = mes * 100 + dia;
  const inicio = rango.desde[0] * 100 + rango.desde[1];
  const fin = rango.hasta[0] * 100 + rango.hasta[1];

  // Rangos que cruzan el fin de año (27 de diciembre al 6 de enero).
  return inicio <= fin ? punto >= inicio && punto <= fin : punto >= inicio || punto <= fin;
}

/** El tema que corresponde hoy según el estado guardado, o null si ninguno. */
export function resolverTema(
  estado: EstadoTema,
  ahora: Date = new Date()
): Tema | null {
  if (estado.modo === "apagado") return null;
  if (estado.modo === "fijo") return buscarTema(estado.temaFijo);

  const { anio, mes, dia } = fechaEnBogota(ahora);
  return (
    TEMAS.find((t) => !estado.apagados.includes(t.id) && enTemporada(t, [mes, dia], anio)) ??
    null
  );
}

/**
 * Texto del rango para mostrarlo en el panel: "24 de octubre al 2 de
 * noviembre". En los que cambian cada año dice la regla y las fechas de la
 * próxima vez; en los que no tienen fecha, cómo se ponen.
 */
export function rangoLegible(tema: Tema, ahora: Date = new Date()): string {
  const MESES = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];

  const parte = ([mes, dia]: Fecha) => `${dia} de ${MESES[mes - 1]}`;
  // "1 de octubre", "7 al 8 de diciembre", "27 de diciembre al 6 de enero".
  const dias = (r: Rango) =>
    r.desde[0] !== r.hasta[0]
      ? `${parte(r.desde)} al ${parte(r.hasta)}`
      : r.desde[1] === r.hasta[1]
        ? parte(r.desde)
        : `${r.desde[1]} al ${parte(r.hasta)}`;

  if ("sinFecha" in tema) return "Sin fecha: sale solo si lo dejas fijo";
  if (!("calcular" in tema)) return dias(tema);

  // Si este año ya pasó, las del próximo.
  const { anio, mes, dia } = fechaEnBogota(ahora);
  const esteAnio = tema.calcular(anio);
  const yaPaso = esteAnio.hasta[0] * 100 + esteAnio.hasta[1] < mes * 100 + dia;
  return yaPaso
    ? `${tema.regla} (en ${anio + 1}: ${dias(tema.calcular(anio + 1))})`
    : `${tema.regla} (este año: ${dias(esteAnio)})`;
}

/** Si el tema puede salir solo en el modo automático. */
export function tieneFecha(tema: Tema): boolean {
  return !("sinFecha" in tema);
}
