/**
 * Modo claro u oscuro del panel de administración y del BackOffice.
 *
 * Lo elige cada quien y queda en una cookie del navegador (no es dato de la
 * cuenta). Se lee en el servidor para pintar la página ya en su modo, sin que
 * se vea un parpadeo claro antes de pasar a oscuro.
 *
 * La consulta de los consultores no usa esto: siempre se ve clara.
 * Sirve en el servidor, en el navegador y en el middleware.
 */

export const COOKIE_MODO = "cartera_modo";

/** "auto" sigue el modo del sistema operativo. */
export type Modo = "claro" | "oscuro" | "auto";

export const MODOS: Modo[] = ["claro", "oscuro", "auto"];

export function esModo(valor: string | null | undefined): Modo {
  return valor === "oscuro" || valor === "auto" ? valor : "claro";
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
