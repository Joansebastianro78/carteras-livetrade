import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_ADMIN, leerSesion } from "@/lib/auth";
import { registrarActividad } from "@/lib/actividad";
import { leerEstadoTema } from "@/lib/temaServidor";
import { resolverTema, TEMAS, type IdTema, type ModoTema } from "@/lib/temas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AVISO_SIN_TABLA =
  "Falta la tabla tema. Ejecuta supabase/gestion.sql en el SQL Editor.";

const MODOS: ModoTema[] = ["automatico", "apagado", "fijo"];

function esTablaFaltante(mensaje: string): boolean {
  return /does not exist|schema cache|relation .* tema/i.test(mensaje);
}

// ------------------------------------------------- estado + qué se ve hoy
export async function GET() {
  const estado = await leerEstadoTema();

  return NextResponse.json({
    estado,
    // Para que el panel pueda decir "hoy se está viendo X" sin repetir la
    // lógica de fechas en el navegador.
    activo: resolverTema(estado)?.id ?? null,
  });
}

// ------------------------------------------------- guardar
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    modo?: string;
    temaFijo?: string | null;
    apagados?: string[];
  };

  const store = await cookies();
  const sesion = await leerSesion(
    store.get(COOKIE_ADMIN)?.value,
    process.env.ADMIN_SECRET
  );

  const validos = new Set(TEMAS.map((t) => t.id));

  const modo: ModoTema = MODOS.includes(body.modo as ModoTema)
    ? (body.modo as ModoTema)
    : "automatico";

  const temaFijo = validos.has(body.temaFijo as IdTema)
    ? (body.temaFijo as IdTema)
    : null;

  if (modo === "fijo" && !temaFijo) {
    return NextResponse.json(
      { error: "Elige cuál tema quieres dejar fijo." },
      { status: 400 }
    );
  }

  const apagados = (body.apagados ?? []).filter((id) => validos.has(id as IdTema));

  const { error } = await supabaseAdmin.from("tema").upsert(
    {
      id: 1,
      modo,
      tema_fijo: temaFijo,
      apagados,
      actualizado_por: sesion?.usuario ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("[tema POST]", error.message);
    return NextResponse.json(
      {
        error: esTablaFaltante(error.message)
          ? AVISO_SIN_TABLA
          : `No se pudo guardar: ${error.message}`,
      },
      { status: 500 }
    );
  }

  const estado = { modo, temaFijo, apagados: apagados as IdTema[] };

  await registrarActividad(sesion?.usuario ?? null, "tema_cambiar", {
    descripcion:
      modo === "apagado"
        ? "Sin decoración"
        : modo === "fijo"
          ? `Fijo: ${TEMAS.find((t) => t.id === temaFijo)?.nombre ?? temaFijo}`
          : "Automático, según las fechas",
  });

  return NextResponse.json({
    ok: true,
    estado,
    activo: resolverTema(estado)?.id ?? null,
  });
}
