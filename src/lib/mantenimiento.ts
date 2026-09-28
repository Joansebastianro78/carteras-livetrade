import { supabaseAdmin } from "./supabaseAdmin";

/**
 * Estado de la ventana de mantenimiento. Vive en una sola fila de Supabase
 * (tabla mantenimiento, id = 1) para que el cambio sea inmediato y no
 * dependa de volver a desplegar ni de variables de entorno.
 *
 * Este módulo usa la service_role key: solo se importa desde el servidor.
 */

export type EstadoMantenimiento = {
  activo: boolean;
  mensaje: string;
  hasta: string | null;
  actualizado_por?: string | null;
  updated_at?: string | null;
};

export const MENSAJE_POR_DEFECTO =
  "Estamos actualizando la cartera. Vuelve a intentar en unos minutos.";

export const ESTADO_ABIERTO: EstadoMantenimiento = {
  activo: false,
  mensaje: MENSAJE_POR_DEFECTO,
  hasta: null,
};

export async function leerMantenimiento(): Promise<EstadoMantenimiento> {
  const { data, error } = await supabaseAdmin
    .from("mantenimiento")
    .select("activo,mensaje,hasta,actualizado_por,updated_at")
    .eq("id", 1)
    .maybeSingle();

  // Si la tabla todavía no existe o la lectura falla, la página se queda
  // ABIERTA. Cerrarla ante un error dejaría a todos los consultores sin
  // cartera por un problema que nadie pidió.
  if (error || !data) {
    if (error) console.error("[mantenimiento]", error.message);
    return ESTADO_ABIERTO;
  }

  return {
    activo: data.activo,
    mensaje: data.mensaje?.trim() || MENSAJE_POR_DEFECTO,
    hasta: data.hasta,
    actualizado_por: data.actualizado_por,
    updated_at: data.updated_at,
  };
}

/** "hasta las 3:20 p. m. de hoy", en hora de Colombia. */
export function textoHasta(hasta: string | null): string | null {
  if (!hasta) return null;
  const fecha = new Date(hasta);
  if (Number.isNaN(fecha.getTime())) return null;

  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(fecha);
}
