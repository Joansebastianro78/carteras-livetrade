import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { esRol } from "@/lib/auth";
import { registrarActividad } from "@/lib/actividad";
import { esTablaFaltante, textoError } from "@/lib/tablaFaltante";
import {
  AVISO_SIN_PERFILES,
  leerPerfiles,
  quedaQuienManejeUsuarios,
  sesionConPermisos,
} from "@/lib/perfilesServidor";
import {
  claveDePerfil,
  cubre,
  esModulo,
  IDS_MODULOS,
  MODULOS,
  SUPERADMIN,
  type IdModulo,
} from "@/lib/permisos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Perfiles y permisos (supabase/perfiles.sql). Pide el módulo «Perfiles y
 * permisos».
 *
 *   GET                                         → los perfiles, cuántos usuarios tiene cada uno y quién pregunta
 *   POST   { nombre, descripcion, modulos }      → crea un perfil
 *   PATCH  { clave, nombre?, descripcion?, modulos? } → lo cambia
 *   DELETE { clave }                             → lo borra
 *
 * Reglas:
 *   - el superadministrador es fijo: lo ve todo y no se edita ni se borra;
 *   - nadie cambia los permisos de su propio perfil;
 *   - solo se dan o quitan permisos que uno también tiene;
 *   - Administrador y BackOffice se editan, pero no se borran;
 *   - un perfil que tiene usuarios no se borra;
 *   - siempre debe quedar alguien activo que pueda manejar los usuarios.
 *
 * Un cambio de permisos le llega a quien tenga el perfil en menos de medio
 * minuto (la memoria del middleware); el menú se le actualiza al recargar.
 */

const LARGO_DESCRIPCION = 300;

type Sesion = NonNullable<Awaited<ReturnType<typeof sesionConPermisos>>>;

function error(texto: string, status: number) {
  return NextResponse.json({ error: texto }, { status });
}

function nombreLimpio(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const nombre = valor.replace(/\s+/g, " ").trim();
  return nombre.length >= 2 && nombre.length <= 60 ? nombre : null;
}

function descripcionLimpia(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  return valor.replace(/\s+/g, " ").trim().slice(0, LARGO_DESCRIPCION) || null;
}

/** Los módulos pedidos, sin repetir y en el orden del catálogo. */
function modulosPedidos(valor: unknown): { modulos: IdModulo[] } | { error: string } {
  if (!Array.isArray(valor)) return { error: "Faltan los módulos del perfil." };
  const raros = valor.filter((m) => !esModulo(m));
  if (raros.length > 0) return { error: `Módulo desconocido: ${String(raros[0]).slice(0, 40)}.` };
  return { modulos: IDS_MODULOS.filter((m) => valor.includes(m)) };
}

const nombreModulo = (id: string) => MODULOS.find((m) => m.id === id)?.nombre ?? id;

/** Los módulos que quien llama no tiene, para decírselo. */
function ajenos(sesion: Sesion, modulos: readonly string[]): string {
  return modulos
    .filter((m) => esModulo(m) && !sesion.modulos.includes(m))
    .map(nombreModulo)
    .join(", ");
}

async function contarUsuarios(): Promise<Map<string, { total: number; activos: number }>> {
  const { data, error: e } = await supabaseAdmin.from("admins").select("rol,activo");
  const cuenta = new Map<string, { total: number; activos: number }>();
  if (e) {
    console.error("[perfiles usuarios]", e.message);
    return cuenta;
  }
  for (const fila of data ?? []) {
    const rol = esRol(fila.rol as string | null);
    const c = cuenta.get(rol) ?? { total: 0, activos: 0 };
    c.total++;
    if (fila.activo) c.activos++;
    cuenta.set(rol, c);
  }
  return cuenta;
}

// ------------------------------------------------- listar
export async function GET() {
  const sesion = await sesionConPermisos();
  if (!sesion) return error("Sesión no válida o expirada.", 401);

  const [{ perfiles, sinTabla, error: e }, cuenta] = await Promise.all([leerPerfiles(), contarUsuarios()]);

  return NextResponse.json({
    perfiles: perfiles.map((p) => ({
      ...p,
      usuarios: cuenta.get(p.clave)?.total ?? 0,
      activos: cuenta.get(p.clave)?.activos ?? 0,
    })),
    sinTabla,
    aviso: sinTabla ? AVISO_SIN_PERFILES : (e ?? null),
    yo: sesion.usuario,
    miPerfil: sesion.rol,
    misModulos: sesion.modulos,
  });
}

// ------------------------------------------------- crear
export async function POST(req: Request) {
  const sesion = await sesionConPermisos();
  if (!sesion) return error("Sesión no válida o expirada.", 401);

  const body = (await req.json().catch(() => ({}))) as {
    nombre?: unknown;
    descripcion?: unknown;
    modulos?: unknown;
  };

  const nombre = nombreLimpio(body.nombre);
  if (!nombre) return error("El nombre del perfil debe tener entre 2 y 60 caracteres.", 400);

  const clave = claveDePerfil(nombre);
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(clave)) {
    return error("El nombre del perfil debe tener al menos dos letras o números.", 400);
  }

  const pedidos = modulosPedidos(body.modulos ?? []);
  if ("error" in pedidos) return error(pedidos.error, 400);
  const { modulos } = pedidos;

  if (!cubre(sesion.rol, sesion.modulos, modulos)) {
    return error(`Solo puedes dar permisos que tú también tienes. Te faltan: ${ajenos(sesion, modulos)}.`, 403);
  }

  const { data, error: e, status } = await supabaseAdmin
    .from("perfiles")
    .insert({
      clave,
      nombre,
      descripcion: descripcionLimpia(body.descripcion),
      modulos,
      sistema: false,
      actualizado_por: sesion.usuario,
    })
    .select("clave,nombre,descripcion,modulos,sistema,actualizado_por,updated_at")
    .single();

  if (e) {
    if (esTablaFaltante(e, status)) return error(AVISO_SIN_PERFILES, 503);
    if (e.code === "23505") {
      return error(`Ya existe un perfil con ese nombre (${clave}). Usa otro o edita el que hay.`, 409);
    }
    console.error("[perfiles POST]", textoError(e, status));
    return error("No se pudo crear el perfil.", 500);
  }

  await registrarActividad(sesion.usuario, "perfil_crear", { nombre, clave, modulos });

  return NextResponse.json({ ok: true, perfil: data });
}

// ------------------------------------------------- cambiar
export async function PATCH(req: Request) {
  const sesion = await sesionConPermisos();
  if (!sesion) return error("Sesión no válida o expirada.", 401);

  const body = (await req.json().catch(() => ({}))) as {
    clave?: unknown;
    nombre?: unknown;
    descripcion?: unknown;
    modulos?: unknown;
  };
  const clave = typeof body.clave === "string" ? body.clave : "";

  if (clave === SUPERADMIN) {
    return error("El perfil de superadministrador es fijo: siempre lo ve todo.", 403);
  }

  const { data: actual, error: e, status } = await supabaseAdmin
    .from("perfiles")
    .select("clave,nombre,descripcion,modulos,sistema")
    .eq("clave", clave)
    .maybeSingle();

  if (e) {
    if (esTablaFaltante(e, status)) return error(AVISO_SIN_PERFILES, 503);
    console.error("[perfiles PATCH]", textoError(e, status));
    return error("No se pudo leer el perfil.", 500);
  }
  if (!actual) return error("Ese perfil no existe.", 404);

  const cambios: { nombre?: string; descripcion?: string | null; modulos?: IdModulo[] } = {};

  if (body.nombre !== undefined) {
    const nombre = nombreLimpio(body.nombre);
    if (!nombre) return error("El nombre del perfil debe tener entre 2 y 60 caracteres.", 400);
    cambios.nombre = nombre;
  }
  if (body.descripcion !== undefined) cambios.descripcion = descripcionLimpia(body.descripcion);

  const antes = ((actual.modulos as string[] | null) ?? []).filter(esModulo);
  let agregados: IdModulo[] = [];
  let quitados: IdModulo[] = [];

  if (body.modulos !== undefined) {
    const pedidos = modulosPedidos(body.modulos);
    if ("error" in pedidos) return error(pedidos.error, 400);
    agregados = pedidos.modulos.filter((m) => !antes.includes(m));
    quitados = antes.filter((m) => !pedidos.modulos.includes(m));

    if (agregados.length > 0 || quitados.length > 0) {
      if (clave === sesion.rol) {
        return error("No puedes cambiar los permisos de tu propio perfil. Pídeselo a otro administrador.", 403);
      }
      const tocados = [...agregados, ...quitados];
      if (!cubre(sesion.rol, sesion.modulos, tocados)) {
        return error(
          `Solo puedes dar o quitar permisos que tú también tienes. Te faltan: ${ajenos(sesion, tocados)}.`,
          403
        );
      }
      if (
        quitados.includes("usuarios") &&
        !(await quedaQuienManejeUsuarios({ perfil: { clave, modulos: pedidos.modulos } }))
      ) {
        return error(
          "Si este perfil deja de ver Administradores, no queda nadie activo que pueda manejar los usuarios del panel.",
          400
        );
      }
      cambios.modulos = pedidos.modulos;
    }
  }

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ ok: true, sinCambios: true });
  }

  const { data, error: e2, status: s2 } = await supabaseAdmin
    .from("perfiles")
    .update({ ...cambios, actualizado_por: sesion.usuario })
    .eq("clave", clave)
    .select("clave,nombre,descripcion,modulos,sistema,actualizado_por,updated_at")
    .maybeSingle();

  if (e2) {
    console.error("[perfiles PATCH]", textoError(e2, s2));
    return error("No se pudo guardar el perfil.", 500);
  }
  if (!data) return error("Ese perfil no existe.", 404);

  await registrarActividad(sesion.usuario, "perfil_editar", {
    nombre: data.nombre,
    clave,
    ...(cambios.nombre && cambios.nombre !== actual.nombre ? { antes: actual.nombre } : {}),
    ...(agregados.length ? { agregados } : {}),
    ...(quitados.length ? { quitados } : {}),
  });

  return NextResponse.json({ ok: true, perfil: data });
}

// ------------------------------------------------- borrar
export async function DELETE(req: Request) {
  const sesion = await sesionConPermisos();
  if (!sesion) return error("Sesión no válida o expirada.", 401);

  const { clave } = (await req.json().catch(() => ({}))) as { clave?: unknown };
  if (typeof clave !== "string" || !clave) return error("Falta el perfil.", 400);

  const { data: actual, error: e, status } = await supabaseAdmin
    .from("perfiles")
    .select("clave,nombre,sistema")
    .eq("clave", clave)
    .maybeSingle();

  if (e) {
    if (esTablaFaltante(e, status)) return error(AVISO_SIN_PERFILES, 503);
    console.error("[perfiles DELETE]", textoError(e, status));
    return error("No se pudo leer el perfil.", 500);
  }
  if (!actual) return error("Ese perfil no existe.", 404);
  if (actual.sistema || clave === SUPERADMIN) {
    return error("Superadministrador, Administrador y BackOffice no se pueden borrar.", 400);
  }
  if (clave === sesion.rol) return error("No puedes borrar tu propio perfil.", 400);

  const { count, error: e2 } = await supabaseAdmin
    .from("admins")
    .select("id", { count: "exact", head: true })
    .eq("rol", clave);

  if (e2) {
    console.error("[perfiles DELETE usuarios]", e2.message);
    return error("No se pudo revisar quién tiene el perfil.", 500);
  }
  if ((count ?? 0) > 0) {
    return error(
      count === 1
        ? "Ese perfil lo tiene 1 usuario (activo o no). Cámbiale el perfil antes de borrarlo."
        : `Ese perfil lo tienen ${count} usuarios (activos o no). Cámbiales el perfil antes de borrarlo.`,
      409
    );
  }

  const { error: e3 } = await supabaseAdmin.from("perfiles").delete().eq("clave", clave);
  if (e3) {
    // La llave de admins.rol también lo impide si alguien lo asignó justo ahora.
    if (e3.code === "23503") return error("Ese perfil tiene usuarios. Cámbiales el perfil antes de borrarlo.", 409);
    console.error("[perfiles DELETE]", e3.message);
    return error("No se pudo borrar el perfil.", 500);
  }

  await registrarActividad(sesion.usuario, "perfil_eliminar", { nombre: actual.nombre, clave });

  return NextResponse.json({ ok: true });
}
