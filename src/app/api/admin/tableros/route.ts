import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_ADMIN, leerSesion, mandaEnElPanel } from "@/lib/auth";
import { normalizarUrlTablero } from "@/lib/tableros";
import { registrarActividad } from "@/lib/actividad";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AVISO_SIN_TABLA =
  "Falta la tabla tableros. Ejecuta supabase/gestion.sql en el SQL Editor.";

function esTablaFaltante(mensaje: string): boolean {
  return /does not exist|schema cache|relation .* tableros/i.test(mensaje);
}

async function sesionActual() {
  const store = await cookies();
  return leerSesion(store.get(COOKIE_ADMIN)?.value, process.env.ADMIN_SECRET);
}

/**
 * El middleware ya deja pasar el GET al perfil BackOffice y le bloquea el
 * resto. Esta función lo vuelve a comprobar aquí: si mañana alguien mueve una
 * ruta en el middleware, la regla de quién escribe no se pierde con ella.
 */
async function soloAdministradores() {
  const sesion = await sesionActual();
  if (!sesion || !mandaEnElPanel(sesion.rol)) {
    return NextResponse.json(
      { error: "Solo un administrador puede cambiar los tableros." },
      { status: 403 }
    );
  }
  return null;
}

// ------------------------------------------------- listar
export async function GET() {
  const sesion = await sesionActual();
  const esAdmin = sesion ? mandaEnElPanel(sesion.rol) : false;

  let consulta = supabaseAdmin
    .from("tableros")
    .select("*")
    .order("orden", { ascending: true })
    .order("created_at", { ascending: true });

  // El BackOffice solo ve los que están publicados; el administrador ve todo
  // para poder preparar uno antes de mostrarlo.
  if (!esAdmin) consulta = consulta.eq("activo", true);

  const { data, error } = await consulta;

  if (error) {
    console.error("[tableros GET]", error.message);
    return NextResponse.json(
      {
        error: esTablaFaltante(error.message)
          ? AVISO_SIN_TABLA
          : "No se pudo leer los tableros.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ tableros: data ?? [], puedeEditar: esAdmin });
}

// ------------------------------------------------- crear o editar
export async function POST(req: Request) {
  const negado = await soloAdministradores();
  if (negado) return negado;

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    nombre?: string;
    descripcion?: string;
    url?: string;
    orden?: number;
  };

  const nombre = (body.nombre ?? "").trim();
  if (nombre.length < 2) {
    return NextResponse.json(
      { error: "Ponle un nombre al tablero." },
      { status: 400 }
    );
  }

  const url = normalizarUrlTablero(body.url ?? "");
  if (!url) {
    return NextResponse.json(
      {
        error:
          "El enlace debe ser de Power BI (app.powerbi.com). Puedes pegar la URL o el código <iframe> que te da el botón Insertar.",
      },
      { status: 400 }
    );
  }

  const sesion = await sesionActual();

  const fila = {
    nombre,
    descripcion: (body.descripcion ?? "").trim() || null,
    url,
    orden: Number.isFinite(body.orden) ? Number(body.orden) : 0,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = body.id
    ? await supabaseAdmin
        .from("tableros")
        .update(fila)
        .eq("id", body.id)
        .select("*")
        .single()
    : await supabaseAdmin
        .from("tableros")
        .insert({ ...fila, creado_por: sesion?.usuario ?? null })
        .select("*")
        .single();

  if (error) {
    console.error("[tableros POST]", error.message);
    return NextResponse.json(
      {
        error: esTablaFaltante(error.message)
          ? AVISO_SIN_TABLA
          : `No se pudo guardar: ${error.message}`,
      },
      { status: 500 }
    );
  }

  await registrarActividad(sesion?.usuario ?? null, body.id ? "tablero_editar" : "tablero_agregar", {
    nombre,
  });

  return NextResponse.json({ ok: true, tablero: data });
}

// ------------------------------------------------- publicar o esconder
export async function PATCH(req: Request) {
  const negado = await soloAdministradores();
  if (negado) return negado;

  const { id, activo } = (await req.json().catch(() => ({}))) as {
    id?: string;
    activo?: boolean;
  };

  if (!id) {
    return NextResponse.json({ error: "Falta el tablero." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("tableros")
    .update({ activo: activo === true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("nombre")
    .maybeSingle();

  if (error) {
    console.error("[tableros PATCH]", error.message);
    return NextResponse.json(
      { error: `No se pudo cambiar: ${error.message}` },
      { status: 500 }
    );
  }

  await registrarActividad(
    (await sesionActual())?.usuario ?? null,
    activo === true ? "tablero_publicar" : "tablero_ocultar",
    { nombre: data?.nombre ?? null }
  );

  return NextResponse.json({ ok: true });
}

// ------------------------------------------------- borrar
export async function DELETE(req: Request) {
  const negado = await soloAdministradores();
  if (negado) return negado;

  const { id } = (await req.json().catch(() => ({}))) as { id?: string };

  if (!id) {
    return NextResponse.json({ error: "Falta el tablero." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("tableros")
    .delete()
    .eq("id", id)
    .select("nombre")
    .maybeSingle();

  if (error) {
    console.error("[tableros DELETE]", error.message);
    return NextResponse.json(
      { error: `No se pudo eliminar: ${error.message}` },
      { status: 500 }
    );
  }

  await registrarActividad((await sesionActual())?.usuario ?? null, "tablero_eliminar", {
    nombre: data?.nombre ?? null,
  });

  return NextResponse.json({ ok: true });
}
