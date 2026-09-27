import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_ADMIN, leerSesion } from "@/lib/auth";
import { MENSAJE_POR_DEFECTO } from "@/lib/mantenimiento";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AVISO_SIN_TABLA =
  "Falta la tabla mantenimiento. Ejecuta supabase/gestion.sql en el SQL Editor.";

function esTablaFaltante(mensaje: string): boolean {
  return /does not exist|schema cache|relation .* mantenimiento/i.test(mensaje);
}

// ------------------------------------------------- estado actual
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("mantenimiento")
    .select("activo,mensaje,hasta,actualizado_por,updated_at")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("[mantenimiento GET]", error.message);
    return NextResponse.json(
      {
        error: esTablaFaltante(error.message)
          ? AVISO_SIN_TABLA
          : "No se pudo leer el estado de mantenimiento.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    estado: data ?? {
      activo: false,
      mensaje: MENSAJE_POR_DEFECTO,
      hasta: null,
      actualizado_por: null,
      updated_at: null,
    },
  });
}

// ------------------------------------------------- abrir o cerrar
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    activo?: boolean;
    mensaje?: string;
    /** ISO o null. Solo informativo: no apaga el mantenimiento por su cuenta. */
    hasta?: string | null;
  };

  const store = await cookies();
  const sesion = await leerSesion(
    store.get(COOKIE_ADMIN)?.value,
    process.env.ADMIN_SECRET
  );

  const mensaje = (body.mensaje ?? "").trim() || MENSAJE_POR_DEFECTO;

  let hasta: string | null = null;
  if (body.hasta) {
    const fecha = new Date(body.hasta);
    if (Number.isNaN(fecha.getTime())) {
      return NextResponse.json(
        { error: "La hora de fin no es válida." },
        { status: 400 }
      );
    }
    hasta = fecha.toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from("mantenimiento")
    .upsert(
      {
        id: 1,
        activo: body.activo === true,
        mensaje,
        hasta,
        actualizado_por: sesion?.usuario ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    )
    .select("activo,mensaje,hasta,actualizado_por,updated_at")
    .single();

  if (error) {
    console.error("[mantenimiento POST]", error.message);
    return NextResponse.json(
      {
        error: esTablaFaltante(error.message)
          ? AVISO_SIN_TABLA
          : `No se pudo guardar: ${error.message}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, estado: data });
}
