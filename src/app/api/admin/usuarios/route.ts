import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_ADMIN, esRol, leerSesion, type Rol } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LARGO_MINIMO_CLAVE = 10;

const PERFILES: Rol[] = ["admin", "backoffice", "superadmin"];

async function quien(): Promise<{ usuario: string | null; rol: Rol }> {
  const store = await cookies();
  const s = await leerSesion(store.get(COOKIE_ADMIN)?.value, process.env.ADMIN_SECRET);
  return { usuario: s?.usuario ?? null, rol: s?.rol ?? "admin" };
}

/** El perfil que tiene hoy ese usuario en la base, o null si no existe. */
async function perfilDe(usuario: string): Promise<Rol | null> {
  const { data } = await supabaseAdmin
    .from("admins")
    .select("rol")
    .eq("usuario", usuario)
    .maybeSingle();

  return data ? esRol(data.rol) : null;
}

/**
 * Un superadministrador solo lo toca otro superadministrador. Sin esta regla
 * cualquier admin podría desactivarlo, cambiarle la clave o ascenderse a sí
 * mismo, y la jerarquía no serviría de nada.
 */
function puedeTocar(quienManda: Rol, perfilDelOtro: Rol | null): boolean {
  if (perfilDelOtro !== "superadmin") return true;
  return quienManda === "superadmin";
}

// ------------------------------------------------- listar
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("admins")
    // clave_hash nunca sale de la base, ni siquiera hacia el panel.
    .select("id,usuario,nombre,rol,activo,ultimo_login,created_at")
    .order("usuario");

  if (error) {
    console.error("[usuarios GET]", error.message);
    return NextResponse.json({ error: "No se pudo leer la lista." }, { status: 500 });
  }

  const sesion = await quien();
  return NextResponse.json({
    usuarios: data ?? [],
    yo: sesion.usuario,
    miRol: sesion.rol,
  });
}

// ------------------------------------------------- crear o cambiar clave
export async function POST(req: Request) {
  const { usuario, clave, nombre, rol } = (await req.json().catch(() => ({}))) as {
    usuario?: string;
    clave?: string;
    nombre?: string;
    rol?: string;
  };

  const perfil: Rol = PERFILES.includes(rol as Rol) ? (rol as Rol) : "admin";
  const limpio = (usuario ?? "").trim().toLowerCase();

  // Los usuarios del panel son correos corporativos, así que la arroba entra.
  if (!/^[a-z0-9._@-]{3,60}$/.test(limpio)) {
    return NextResponse.json(
      {
        error:
          "El usuario debe tener entre 3 y 60 caracteres: letras, números, punto, arroba, guion o guion bajo.",
      },
      { status: 400 }
    );
  }

  const sesion = await quien();

  if (perfil === "superadmin" && sesion.rol !== "superadmin") {
    return NextResponse.json(
      { error: "Solo un superadministrador puede crear otro superadministrador." },
      { status: 403 }
    );
  }

  if (!puedeTocar(sesion.rol, await perfilDe(limpio))) {
    return NextResponse.json(
      { error: "Esa cuenta es de un superadministrador. Solo él puede cambiarla." },
      { status: 403 }
    );
  }

  if (!clave || clave.length < LARGO_MINIMO_CLAVE) {
    return NextResponse.json(
      { error: `La clave debe tener al menos ${LARGO_MINIMO_CLAVE} caracteres.` },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin.rpc("crear_admin", {
    p_usuario: limpio,
    p_clave: clave,
    p_nombre: (nombre ?? "").trim() || null,
    p_rol: perfil,
  });

  if (error) {
    console.error("[usuarios POST]", error.message);

    const faltaRol = /p_rol|crear_admin/i.test(error.message);
    return NextResponse.json(
      {
        error: faltaRol
          ? "La función crear_admin todavía no acepta perfiles. Ejecuta supabase/roles.sql en el SQL Editor."
          : `No se pudo guardar: ${error.message}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, usuario: limpio, rol: perfil });
}

// ------------------------------------------------- activar / desactivar
export async function PATCH(req: Request) {
  const { usuario, activo } = (await req.json().catch(() => ({}))) as {
    usuario?: string;
    activo?: boolean;
  };

  const limpio = (usuario ?? "").trim().toLowerCase();
  if (!limpio || typeof activo !== "boolean") {
    return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
  }

  const sesion = await quien();
  if (limpio === sesion.usuario && activo === false) {
    return NextResponse.json(
      { error: "No puedes desactivar tu propia cuenta." },
      { status: 400 }
    );
  }

  const objetivo = await perfilDe(limpio);

  if (!puedeTocar(sesion.rol, objetivo)) {
    return NextResponse.json(
      {
        error:
          "No puedes desactivar al superadministrador. Solo él puede hacerlo.",
      },
      { status: 403 }
    );
  }

  if (!activo && objetivo !== "backoffice") {
    // Los perfiles BackOffice no cuentan: desactivarlos a todos no deja el
    // panel sin dueño, pero quedarse sin administradores sí.
    const { count } = await supabaseAdmin
      .from("admins")
      .select("id", { count: "exact", head: true })
      .eq("activo", true)
      .in("rol", ["admin", "superadmin"]);

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Debe quedar al menos un administrador activo." },
        { status: 400 }
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from("admins")
    .update({ activo })
    .eq("usuario", limpio)
    .select("usuario,rol,activo")
    .maybeSingle();

  if (error) {
    console.error("[usuarios PATCH]", error.message);
    return NextResponse.json({ error: "No se pudo actualizar." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Ese usuario no existe." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...data });
}
