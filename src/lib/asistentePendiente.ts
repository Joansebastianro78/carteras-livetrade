/**
 * Una pregunta escrita en el Inicio que el Asistente IA toma al abrirse.
 * Solo navegador: queda en sessionStorage hasta que el asistente la lee.
 */

const LLAVE = "cartera.asistente.pendiente";

export type PreguntaPendiente = {
  texto: string;
  /** true: el asistente la envía de una vez; false: la deja escrita para editarla. */
  enviar: boolean;
};

/** Sugerencias del Inicio: lo que se ve en el botón y lo que queda escrito. */
export const SUGERENCIAS_INICIO: { corta: string; texto: string }[] = [
  { corta: "Mensaje para un consultor", texto: "Redacta un mensaje para un consultor que no ha cargado sus visitas" },
  { corta: "Fórmula de Excel", texto: "Escribe una fórmula de Excel que busque un código en otra hoja" },
  { corta: "Puntos asignados hoy", texto: "¿Cuántos puntos se asignaron hoy y a qué consultores?" },
];

export function dejarPregunta(p: PreguntaPendiente) {
  try {
    sessionStorage.setItem(LLAVE, JSON.stringify(p));
  } catch {
    // sin almacenamiento: el asistente se abre vacío
  }
}

/** La pregunta pendiente, si hay, y la borra para que no se repita. */
export function tomarPregunta(): PreguntaPendiente | null {
  try {
    const crudo = sessionStorage.getItem(LLAVE);
    if (!crudo) return null;
    sessionStorage.removeItem(LLAVE);
    const p = JSON.parse(crudo) as Partial<PreguntaPendiente>;
    return typeof p.texto === "string" && p.texto.trim() ? { texto: p.texto.trim().slice(0, 4000), enviar: p.enviar === true } : null;
  } catch {
    return null;
  }
}
