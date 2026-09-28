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
  | "amor-amistad";

export type Tema = {
  id: IdTema;
  nombre: string;
  /** Qué se ve en pantalla, para que el panel lo explique sin adivinar. */
  decoracion: string;
  /** [mes, día] con el mes empezando en 1. El rango incluye los dos extremos. */
  desde: [number, number];
  hasta: [number, number];
};

/**
 * El orden importa: gana el primero que coincida con la fecha. Por eso los
 * rangos cortos y más específicos (las velitas, el año nuevo) van antes que
 * navidad, que los cubre a ambos.
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

/** Día y mes en hora de Colombia, sin importar dónde corra el servidor. */
export function hoyEnBogota(ahora: Date = new Date()): [number, number] {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ahora);

  const valor = (tipo: string) =>
    Number(partes.find((p) => p.type === tipo)?.value ?? "1");

  return [valor("month"), valor("day")];
}

/** ¿La fecha [mes, día] cae dentro del rango del tema? */
export function enTemporada(tema: Tema, [mes, dia]: [number, number]): boolean {
  const punto = mes * 100 + dia;
  const inicio = tema.desde[0] * 100 + tema.desde[1];
  const fin = tema.hasta[0] * 100 + tema.hasta[1];

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

  const hoy = hoyEnBogota(ahora);
  return (
    TEMAS.find((t) => !estado.apagados.includes(t.id) && enTemporada(t, hoy)) ?? null
  );
}

/** Texto del rango para mostrarlo en el panel: "24 de octubre al 2 de noviembre". */
export function rangoLegible(tema: Tema): string {
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

  const parte = ([mes, dia]: [number, number]) => `${dia} de ${MESES[mes - 1]}`;
  return `${parte(tema.desde)} al ${parte(tema.hasta)}`;
}
