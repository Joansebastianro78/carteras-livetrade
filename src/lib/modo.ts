/**
 * Apariencia del panel de administración y del BackOffice: claro, oscuro,
 * automático o uno de los temas de color.
 *
 * Lo elige cada quien y queda en una cookie del navegador (no es dato de la
 * cuenta). Se lee en el servidor para pintar la página ya en su modo, sin que
 * se vea un parpadeo claro antes de pasar a oscuro.
 *
 * Cada tema de color parte del modo claro o del oscuro (data-modo) y cambia
 * sus colores encima (data-paleta), así que todo lo que el oscuro arregla
 * —el mapa, los avisos— también vale para los temas oscuros. Los colores de
 * cada uno están en src/app/globals.css.
 *
 * La consulta de los consultores no usa esto: siempre se ve clara.
 * Sirve en el servidor, en el navegador y en el middleware.
 */

export const COOKIE_MODO = "cartera_modo";

export type Paleta = {
  id: string;
  nombre: string;
  /** El modo del que parte. */
  base: "claro" | "oscuro";
  /** Para la muestra del selector: fondo, tarjeta, texto y acento. */
  muestra: readonly [string, string, string, string];
};

/** Los temas de color, en el orden del selector: primero los claros. */
export const PALETAS = [
  { id: "arena", nombre: "Arena", base: "claro", muestra: ["#f1ebe1", "#fffdf9", "#2f241a", "#8a5a2b"] },
  { id: "menta", nombre: "Menta", base: "claro", muestra: ["#e6f1ec", "#ffffff", "#0e3328", "#1f7a5c"] },
  { id: "lavanda", nombre: "Lavanda", base: "claro", muestra: ["#eeebf6", "#fefdff", "#261f42", "#5a45a0"] },
  { id: "cielo", nombre: "Cielo", base: "claro", muestra: ["#e6eef7", "#ffffff", "#0f2740", "#1f5f99"] },
  { id: "rosa", nombre: "Rosa", base: "claro", muestra: ["#f7e9ee", "#fffbfc", "#3b1426", "#9c3b62"] },
  { id: "terracota", nombre: "Terracota", base: "claro", muestra: ["#f4e9e2", "#fffaf7", "#3a1c10", "#a14b26"] },
  { id: "medianoche", nombre: "Medianoche", base: "oscuro", muestra: ["#0a1120", "#111a2d", "#e4e9f5", "#7f9bd6"] },
  { id: "bosque", nombre: "Bosque", base: "oscuro", muestra: ["#0b1611", "#122019", "#e1eee6", "#79b596"] },
  { id: "cafe", nombre: "Café", base: "oscuro", muestra: ["#14100c", "#1e1712", "#f1e7dc", "#c69a6d"] },
  { id: "grafito", nombre: "Grafito", base: "oscuro", muestra: ["#121212", "#1b1c1e", "#ececec", "#a0a7b0"] },
  { id: "vino", nombre: "Vino", base: "oscuro", muestra: ["#170b10", "#21111a", "#f3e3ea", "#d58aa8"] },
  { id: "alto-contraste", nombre: "Alto contraste", base: "oscuro", muestra: ["#000000", "#000000", "#ffffff", "#ffd400"] },
] as const satisfies readonly Paleta[];

export type IdPaleta = (typeof PALETAS)[number]["id"];

/** "auto" sigue el modo del sistema operativo. */
export type Modo = "claro" | "oscuro" | "auto" | IdPaleta;

export const MODOS: Modo[] = ["claro", "oscuro", "auto", ...PALETAS.map((p) => p.id)];

export function esModo(valor: string | null | undefined): Modo {
  return MODOS.find((m) => m === valor) ?? "claro";
}

/** El tema de color elegido, o null si es claro, oscuro o automático. */
export function paletaDe(modo: Modo): Paleta | null {
  return PALETAS.find((p) => p.id === modo) ?? null;
}

/** El modo del que parte: lo que va en data-modo. */
export function baseDe(modo: Modo): "claro" | "oscuro" | "auto" {
  return paletaDe(modo)?.base ?? (modo as "claro" | "oscuro" | "auto");
}

/**
 * Encabezado que el middleware le pone a las páginas del panel. El layout lo
 * lee para saber si debe aplicar el modo; la consulta nunca lo trae.
 */
export const ENCABEZADO_PANEL = "x-cartera-panel";

/** Un año: es una preferencia, no una sesión. */
export const DURACION_COOKIE_MODO_S = 365 * 24 * 60 * 60;

/**
 * Si cada quien dejó oculto el menú lateral del panel (solo en pantallas
 * grandes; en el celular el menú siempre se despliega con su botón). También
 * va en cookie para que la página llegue ya sin menú, sin que se vea cerrarse.
 */
export const COOKIE_MENU = "cartera_menu";
