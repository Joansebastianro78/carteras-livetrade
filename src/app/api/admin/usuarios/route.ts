import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_ADMIN, leerSesion } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LARGO_MINIMO_CLAVE = 10;

async function quien(): Promise<string | null> {
  const store = await cookies();
  const s = await leerSesion(store.get(COOKIE_ADMIN)?.value, process.env.ADMIN_SECRET);
  return s?.usuario ?? null;
}

// ------------------------------------------------- listar
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("admins")
    // clave_hash nunca sale de la base, ni siquiera hacia el panel.
    .select("id,usuario,nombre,activo,ultimo_login,created_at")
    .order("usuario");

  if (error) {
    console.error("[usuarios GET]", error.message);
    return NextResponse.json({ error: "No se pudo leer la lista." }, { status: 500 });
  }

  return NextResponse.json({ usuarios: data ?? [], yo: await quien() });
}

// ------------------------------------------------- crear o cambiar clave
export async function POST(req: Request) {
  const { usuario, clave, nombre } = (await req.json().catch(() => ({}))) as {
    usuario?: string;
    clave?: string;
    nombre?: string;
  };

  const limpio = (usuario ?? "").trim().toLowerCase();

  if (!/^[a-z0-9._-]{3,40}$/.test(limpio)) {
    return NextResponse.json(
      {
        error:
          "El usuario debe tener entre 3 y 40 caracteres: letras, números, punto, guion o guion bajo.",
      },
      { status: 400 }
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
  });

  if (error) {
    console.error("[usuarios POST]", error.message);
    return NextResponse.json(
      { error: `No se pudo guardar: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, usuario: limpio });
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

  const yo = await quien();
  if (limpio === yo && activo === false) {
    return NextResponse.json(
      { error: "No puedes desactivar tu propia cuenta." },
      { status: 400 }
    );
  }

  if (!activo) {
    const { count } = await supabaseAdmin
      .from("admins")
      .select("id", { count: "exact", head: true })
      .eq("activo", true);

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
    .select("usuario,activo")
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
