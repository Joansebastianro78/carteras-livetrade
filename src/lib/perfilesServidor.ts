import { cookies } from "next/headers";
import { supabaseAdmin } from "./supabaseAdmin";
import { esTablaFaltante } from "./tablaFaltante";
import { COOKIE_ADMIN, esRol, leerSesion } from "./auth";
import { modulosEfectivos, PERFILES_BASE, SUPERADMIN, type IdModulo } from "./permisos";

/**
 * Perfiles y permisos, del lado del servidor. SOLO SERVIDOR.
 * Sin supabase/perfiles.sql valen los tres perfiles de siempre.
 */

export type Perfil = {
  clave: string;
  nombre: string;
  descripcion: string | null;
  modulos: IdModulo[];
  sistema: boolean;
  actualizado_por: string | null;
  updated_at: string | null;
};

export const AVISO_SIN_PERFILES =
  "Para crear perfiles y cambiar permisos falta la tabla perfiles. Ejecuta supabase/perfiles.sql en el SQL Editor.";

function desdeBase(): Perfil[] {
  return PERFILES_BASE.map((p) => ({
    clave: p.clave,
    nombre: p.nombre,
    descripcion: p.descripcion,
    modulos: modulosEfectivos(p.clave, null),
    sistema: true,
    actualizado_por: null,
    updated_at: null,
  }));
}

/** Los de siempre primero (superadmin, admin, backoffice) y después los demás por nombre. */
function orden(a: Perfil, b: Perfil): number {
  const puesto = (clave: string) => {
    const i = PERFILES_BASE.findIndex((p) => p.clave === clave);
    return i === -1 ? PERFILES_BASE.length : i;
  };
  return puesto(a.clave) - puesto(b.clave) || a.nombre.localeCompare(b.nombre, "es");
}

/** Todos los perfiles. sinTabla: falta perfiles.sql y salen los de siempre. */
export async function leerPerfiles(): Promise<{ perfiles: Perfil[]; sinTabla: boolean; error?: string }> {
  const { data, error, status } = await supabaseAdmin
    .from("perfiles")
    .select("clave,nombre,descripcion,modulos,sistema,actualizado_por,updated_at");

  if (error) {
    if (esTablaFaltante(error, status)) return { perfiles: desdeBase(), sinTabla: true };
    console.error("[perfiles]", error.message);
    return { perfiles: desdeBase(), sinTabla: false, error: "No se pudieron leer los perfiles." };
  }

  return {
    sinTabla: false,
    perfiles: (data ?? []).map((p) => ({
      clave: p.clave as string,
      nombre: p.nombre as string,
      descripcion: (p.descripcion as string | null) ?? null,
      modulos: modulosEfectivos(p.clave as string, (p.modulos as string[] | null) ?? []),
      sistema: Boolean(p.sistema),
      actualizado_por: (p.actualizado_por as string | null) ?? null,
      updated_at: (p.updated_at as string | null) ?? null,
    })).sort(orden),
  };
}

/** Nombre y módulos de un perfil. Uno que no existe no ve nada. */
export async function perfilDe(clave: string): Promise<{ nombre: string; modulos: IdModulo[] }> {
  const { data, error, status } = await supabaseAdmin
    .from("perfiles")
    .select("nombre,modulos")
    .eq("clave", clave)
    .maybeSingle();

  if (error) {
    if (!esTablaFaltante(error, status)) console.error("[perfil]", error.message);
    const base = PERFILES_BASE.find((p) => p.clave === clave);
    return { nombre: base?.nombre ?? clave, modulos: modulosEfectivos(clave, null) };
  }
  if (!data) return { nombre: clave, modulos: clave === SUPERADMIN ? modulosEfectivos(clave, null) : [] };
  return {
    nombre: data.nombre as string,
    modulos: modulosEfectivos(clave, (data.modulos as string[] | null) ?? []),
  };
}

/** La sesión de quien llama, con el nombre y los módulos de su perfil. */
export async function sesionConPermisos(): Promise<{
  usuario: string;
  rol: string;
  nombrePerfil: string;
  modulos: IdModulo[];
} | null> {
  const store = await cookies();
  const sesion = await leerSesion(store.get(COOKIE_ADMIN)?.value, process.env.ADMIN_SECRET);
  if (!sesion) return null;
  const perfil = await perfilDe(sesion.rol);
  return { usuario: sesion.usuario, rol: sesion.rol, nombrePerfil: perfil.nombre, modulos: perfil.modulos };
}

/**
 * Si después de un cambio sigue habiendo alguien activo que pueda manejar los
 * usuarios del panel: un superadministrador o un perfil con el módulo
 * Administradores. Sin nadie así, nadie podría volver a dar permisos.
 *
 *   usuario: ese usuario queda con ese perfil (rol null: queda desactivado)
 *   perfil:  ese perfil queda con esos módulos
 *
 * Si no se puede leer la base, responde que no: mejor frenar el cambio que
 * dejar el panel sin dueño.
 */
export async function quedaQuienManejeUsuarios(cambio: {
  usuario?: { usuario: string; rol: string | null };
  perfil?: { clave: string; modulos: readonly string[] };
}): Promise<boolean> {
  const [activos, { perfiles }] = await Promise.all([
    supabaseAdmin.from("admins").select("usuario,rol").eq("activo", true),
    leerPerfiles(),
  ]);
  if (activos.error) {
    console.error("[perfiles quedan]", activos.error.message);
    return false;
  }

  const modulosDe = (clave: string): IdModulo[] => {
    if (cambio.perfil && cambio.perfil.clave === clave) return modulosEfectivos(clave, cambio.perfil.modulos);
    return perfiles.find((p) => p.clave === clave)?.modulos ?? modulosEfectivos(clave, null);
  };

  return (activos.data ?? []).some((fila) => {
    let rol: string | null = esRol(fila.rol as string | null);
    if (cambio.usuario && fila.usuario === cambio.usuario.usuario) rol = cambio.usuario.rol;
    if (rol === null) return false;
    return rol === SUPERADMIN || modulosDe(rol).includes("usuarios");
  });
}
