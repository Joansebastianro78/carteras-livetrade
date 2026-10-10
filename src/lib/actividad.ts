import { supabaseAdmin } from "./supabaseAdmin";
import { esTablaFaltante, textoError } from "./tablaFaltante";

/**
 * Registro de lo que se hace en el panel (tabla actividad_panel, en
 * supabase/panel.sql). SOLO SERVIDOR.
 *
 * Nunca hace fallar la acción que registra: si la tabla todavía no existe,
 * la acción ya se hizo y eso es lo que importa. El aviso sale una sola vez en
 * el log del servidor.
 */

export type AccionPanel =
  | "mantenimiento_abrir"
  | "mantenimiento_cerrar"
  | "usuario_crear"
  | "usuario_clave"
  | "usuario_rol"
  | "usuario_activar"
  | "usuario_desactivar"
  | "tablero_agregar"
  | "tablero_editar"
  | "tablero_publicar"
  | "tablero_ocultar"
  | "tablero_eliminar"
  | "tema_cambiar";

let avisado = false;

export async function registrarActividad(
  usuario: string | null,
  accion: AccionPanel,
  detalle?: Record<string, unknown>
): Promise<void> {
  try {
    const { error, status } = await supabaseAdmin
      .from("actividad_panel")
      .insert({ usuario, accion, detalle: detalle ?? null });
    if (error && !avisado) {
      avisado = true;
      console.warn(
        "[actividad] no se registró:",
        esTablaFaltante(error, status)
          ? "falta la tabla actividad_panel (supabase/panel.sql)"
          : textoError(error, status)
      );
    }
  } catch (e) {
    if (!avisado) {
      avisado = true;
      console.warn("[actividad] no se registró:", (e as Error).message);
    }
  }
}
