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
  | "tema_cambiar"
  | "perfil_crear"
  | "perfil_editar"
  | "perfil_eliminar"
  | "revisados_carga"
  | "revisados_deshacer"
  | "query_fotos_crear"
  | "query_fotos_editar"
  | "query_fotos_eliminar";

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

// ------------------------------------------------------------------ leer

export type ItemActividad = {
  momento: string;
  usuario: string | null;
  accion: string;
  detalle: Record<string, unknown> | null;
};

/**
 * Lo último que pasó en el panel. Junta tres tablas:
 *   cargas_cartera     → cada carga de Excel
 *   auditoria_cartera  → ediciones, borrados y purgas de puntos
 *   actividad_panel    → todo lo demás (supabase/panel.sql)
 * La usan la ruta /api/admin/actividad (el Inicio) y el Asistente IA.
 */
export async function leerActividad(limite: number): Promise<{ actividad: ItemActividad[]; aviso: string | null }> {
  const [cargas, cambios, panel] = await Promise.all([
    supabaseAdmin
      .from("cargas_cartera")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limite),
    supabaseAdmin
      .from("auditoria_cartera")
      .select("accion,id_pdv,ciclo,detalle,hecho_por,created_at")
      .order("created_at", { ascending: false })
      .limit(limite),
    supabaseAdmin
      .from("actividad_panel")
      .select("usuario,accion,detalle,created_at")
      .order("created_at", { ascending: false })
      .limit(limite),
  ]);

  const items: ItemActividad[] = [];

  if (cargas.error) console.error("[actividad cargas]", cargas.error.message);
  for (const c of cargas.data ?? []) {
    items.push({
      momento: c.created_at,
      usuario: c.cargado_por ?? null,
      accion: "cargar",
      detalle: {
        archivo: c.archivo,
        modo: c.modo ?? null,
        filas: c.filas_ok,
        observaciones: c.filas_error ?? 0,
      },
    });
  }

  if (cambios.error) console.error("[actividad cambios]", cambios.error.message);
  for (const c of cambios.data ?? []) {
    items.push({
      momento: c.created_at,
      usuario: c.hecho_por ?? null,
      accion: c.accion,
      detalle: {
        ...((c.detalle as Record<string, unknown> | null) ?? {}),
        id_pdv: c.id_pdv,
        ciclo: c.ciclo,
      },
    });
  }

  // Sin panel.sql la tabla no existe: se avisa, pero lo demás sigue saliendo.
  let aviso: string | null = null;
  if (panel.error) {
    console.error("[actividad panel]", textoError(panel.error, panel.status));
    aviso = esTablaFaltante(panel.error, panel.status)
      ? "Para ver también los cambios de usuarios, mantenimiento, tableros y temas, ejecuta supabase/panel.sql en el SQL Editor."
      : null;
  }
  for (const a of panel.data ?? []) {
    items.push({
      momento: a.created_at,
      usuario: a.usuario ?? null,
      accion: a.accion,
      detalle: (a.detalle as Record<string, unknown> | null) ?? null,
    });
  }

  items.sort((a, b) => Date.parse(b.momento) - Date.parse(a.momento));

  return { actividad: items.slice(0, limite), aviso };
}
