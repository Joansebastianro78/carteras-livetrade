import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { esRol, type Rol } from "@/lib/auth";
import { registrarActividad } from "@/lib/actividad";
import {
  leerPerfiles,
  quedaQuienManejeUsuarios,
  sesionConPermisos,
  type Perfil,
} from "@/lib/perfilesServidor";
import { cubre, SUPERADMIN, type IdModulo } from "@/lib/permisos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LARGO_MINIMO_CLAVE = 10;

type Quien = { usuario: string | null; rol: Rol; modulos: IdModulo[] };

async function quien(): Promise<Quien> {
  const s = await sesionConPermisos();
  return { usuario: s?.usuario ?? null, rol: s?.rol ?? "", modulos: s?.modulos ?? [] };
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
 * Si quien manda puede dar ese perfil, o tocar a alguien que lo tiene:
 *   - el de superadministrador solo lo da (y a quien lo tiene solo lo toca)
 *     otro superadministrador. Sin esta regla cualquier admin podría
 *     desactivarlo, cambiarle la clave o ascenderse a sí mismo;
 *   - los demás, solo quien ya tiene todos sus módulos: nadie crea a alguien
 *     con más permisos que los suyos.
 */
function puedeDar(sesion: Quien, perfil: Rol | null, perfiles: Perfil[]): boolean {
  if (perfil === null) return true;
  if (sesion.rol === SUPERADMIN) return true;
  if (perfil === SUPERADMIN) return false;
  const modulos = perfiles.find((p) => p.clave === perfil)?.modulos ?? [];
  return cubre(sesion.rol, sesion.modulos, modulos);
}

const NO_PUEDE_TOCAR = (perfil: Rol | null) =>
  perfil === SUPERADMIN
    ? "Esa cuenta es de un superadministrador. Solo otro superadministrador puede cambiarla."
    : "Ese usuario tiene permisos que tú no tienes: solo lo puede cambiar alguien que también los tenga.";

const nombreDe = (perfiles: Perfil[], clave: Rol | null) =>
  perfiles.find((p) => p.clave === clave)?.nombre ?? clave;

// ------------------------------------------------- listar
export async function GET() {
  const [{ data, error }, sesion, lectura] = await Promise.all([
    supabaseAdmin
      .from("admins")
      // clave_hash nunca sale de la base, ni siquiera hacia el panel.
      .select("id,usuario,nombre,rol,activo,ultimo_login,created_at")
      .order("usuario"),
    quien(),
    leerPerfiles(),
  ]);

  if (error) {
    console.error("[usuarios GET]", error.message);
    return NextResponse.json({ error: "No se pudo leer la lista." }, { status: 500 });
  }

  return NextResponse.json({
    usuarios: data ?? [],
    yo: sesion.usuario,
    miRol: sesion.rol,
    // Para la lista de perfiles de cada fila y del formulario. asignable:
    // si quien pregunta lo puede dar (la API lo vuelve a revisar al guardar).
    perfiles: lectura.perfiles.map((p) => ({
      clave: p.clave,
      nombre: p.nombre,
      descripcion: p.descripcion,
      modulos: p.modulos,
      sistema: p.sistema,
      asignable: puedeDar(sesion, p.clave, lectura.perfiles),
    })),
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

  const [sesion, { perfiles }, antes] = await Promise.all([quien(), leerPerfiles(), perfilDe(limpio)]);

  const perfil = typeof rol === "string" ? rol : "";
  if (!perfiles.some((p) => p.clave === perfil)) {
    return NextResponse.json({ error: "Elige un perfil que exista." }, { status: 400 });
  }

  if (perfil === SUPERADMIN && sesion.rol !== SUPERADMIN) {
    return NextResponse.json(
      { error: "Solo un superadministrador puede crear otro superadministrador." },
      { status: 403 }
    );
  }

  if (!puedeDar(sesion, antes, perfiles)) {
    return NextResponse.json({ error: NO_PUEDE_TOCAR(antes) }, { status: 403 });
  }

  if (!puedeDar(sesion, perfil, perfiles)) {
    return NextResponse.json(
      { error: "Solo puedes dar perfiles con permisos que tú también tienes." },
      { status: 403 }
    );
  }

  // Volver a guardar la propia cuenta con otro perfil es cambiarse el perfil a
  // sí mismo: se podría quedar el panel sin quien lo maneje.
  if (limpio === sesion.usuario && antes !== null && antes !== perfil) {
    return NextResponse.json(
      { error: "No puedes cambiar tu propio perfil. Pídeselo a otro administrador." },
      { status: 400 }
    );
  }

  if (!clave || clave.length < LARGO_MINIMO_CLAVE) {
    return NextResponse.json(
      { error: `La clave debe tener al menos ${LARGO_MINIMO_CLAVE} caracteres.` },
      { status: 400 }
    );
  }

  if (
    antes !== null &&
    antes !== perfil &&
    !(await quedaQuienManejeUsuarios({ usuario: { usuario: limpio, rol: perfil } }))
  ) {
    return NextResponse.json(
      { error: "Con ese cambio no queda nadie activo que pueda manejar los usuarios del panel." },
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

  await registrarActividad(sesion.usuario, antes === null ? "usuario_crear" : "usuario_clave", {
    usuario: limpio,
    rol: perfil,
    perfil: nombreDe(perfiles, perfil),
    ...(antes !== null && antes !== perfil ? { antes, perfilAntes: nombreDe(perfiles, antes) } : {}),
  });

  return NextResponse.json({ ok: true, usuario: limpio, rol: perfil, perfil: nombreDe(perfiles, perfil) });
}

// ------------------------------------------------- activar / desactivar o cambiar perfil
/**
 * { usuario, activo }  → activar o desactivar la cuenta
 * { usuario, rol }     → cambiarle el perfil sin tocar su clave
 *
 * Reglas del perfil:
 *   - nadie se cambia el perfil a sí mismo;
 *   - dar o quitar el perfil de superadministrador solo lo hace otro
 *     superadministrador;
 *   - los demás perfiles los da (y los quita) quien tenga todos sus módulos;
 *   - debe quedar al menos un usuario activo que pueda manejar los usuarios.
 * Si el usuario tenía una sesión abierta, el middleware la cierra en su
 * siguiente clic y le pide volver a entrar con el perfil nuevo.
 */
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    usuario?: string;
    activo?: boolean;
    rol?: string;
  };

  const limpio = (body.usuario ?? "").trim().toLowerCase();
  const sesion = await quien();

  if (limpio && body.rol !== undefined) return cambiarPerfil(limpio, body.rol, sesion);

  const activo = body.activo;
  if (!limpio || typeof activo !== "boolean") {
    return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
  }

  if (limpio === sesion.usuario && activo === false) {
    return NextResponse.json(
      { error: "No puedes desactivar tu propia cuenta." },
      { status: 400 }
    );
  }

  const [objetivo, { perfiles }] = await Promise.all([perfilDe(limpio), leerPerfiles()]);

  if (!puedeDar(sesion, objetivo, perfiles)) {
    return NextResponse.json(
      {
        error:
          objetivo === SUPERADMIN
            ? "No puedes desactivar al superadministrador. Solo otro superadministrador puede hacerlo."
            : NO_PUEDE_TOCAR(objetivo),
      },
      { status: 403 }
    );
  }

  // Los perfiles que no manejan usuarios no cuentan: desactivarlos a todos no
  // deja el panel sin dueño, pero quedarse sin quien maneje los usuarios sí.
  if (!activo && !(await quedaQuienManejeUsuarios({ usuario: { usuario: limpio, rol: null } }))) {
    return NextResponse.json(
      { error: "Debe quedar al menos un usuario activo que pueda manejar los usuarios del panel." },
      { status: 400 }
    );
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

  await registrarActividad(sesion.usuario, activo ? "usuario_activar" : "usuario_desactivar", {
    usuario: limpio,
  });

  return NextResponse.json({ ok: true, ...data });
}

async function cambiarPerfil(usuario: string, rolPedido: unknown, sesion: Quien) {
  const { perfiles } = await leerPerfiles();
  const nuevo = typeof rolPedido === "string" ? rolPedido : "";
  if (!perfiles.some((p) => p.clave === nuevo)) {
    return NextResponse.json({ error: "Ese perfil no existe." }, { status: 400 });
  }

  if (usuario === sesion.usuario) {
    return NextResponse.json(
      { error: "No puedes cambiar tu propio perfil. Pídeselo a otro administrador." },
      { status: 400 }
    );
  }

  const antes = await perfilDe(usuario);
  if (antes === null) {
    return NextResponse.json({ error: "Ese usuario no existe." }, { status: 404 });
  }
  if (antes === nuevo) {
    return NextResponse.json({ ok: true, usuario, rol: nuevo, sinCambios: true });
  }

  if ((antes === SUPERADMIN || nuevo === SUPERADMIN) && sesion.rol !== SUPERADMIN) {
    return NextResponse.json(
      {
        error:
          "Solo un superadministrador puede dar o quitar el perfil de superadministrador.",
      },
      { status: 403 }
    );
  }

  if (!puedeDar(sesion, antes, perfiles)) {
    return NextResponse.json({ error: NO_PUEDE_TOCAR(antes) }, { status: 403 });
  }
  if (!puedeDar(sesion, nuevo, perfiles)) {
    return NextResponse.json(
      { error: "Solo puedes dar perfiles con permisos que tú también tienes." },
      { status: 403 }
    );
  }

  if (!(await quedaQuienManejeUsuarios({ usuario: { usuario, rol: nuevo } }))) {
    return NextResponse.json(
      { error: "Con ese cambio no queda nadie activo que pueda manejar los usuarios del panel." },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("admins")
    .update({ rol: nuevo })
    .eq("usuario", usuario)
    .select("usuario,rol,activo")
    .maybeSingle();

  if (error) {
    console.error("[usuarios PATCH rol]", error.message);
    // Lo borraron mientras tanto: la llave admins.rol → perfiles no lo deja.
    if (error.code === "23503" || /admins_rol_perfil/i.test(error.message)) {
      return NextResponse.json({ error: "Ese perfil ya no existe. Recarga la página." }, { status: 400 });
    }
    const faltaRol = /column .*rol|admins_rol_valido/i.test(error.message);
    return NextResponse.json(
      {
        error: faltaRol
          ? "La tabla de usuarios todavía no tiene perfiles. Ejecuta supabase/roles.sql en el SQL Editor."
          : "No se pudo cambiar el perfil.",
      },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Ese usuario no existe." }, { status: 404 });
  }

  await registrarActividad(sesion.usuario, "usuario_rol", {
    usuario,
    antes,
    ahora: nuevo,
    perfilAntes: nombreDe(perfiles, antes),
    perfilAhora: nombreDe(perfiles, nuevo),
  });

  return NextResponse.json({ ok: true, usuario, rol: nuevo, antes, perfil: nombreDe(perfiles, nuevo) });
}
