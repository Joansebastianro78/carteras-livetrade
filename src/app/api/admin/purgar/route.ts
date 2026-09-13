import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_ADMIN, leerSesion } from "@/lib/auth";
import { FRASE_PURGA } from "@/lib/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ------------------------------------------------- resumen por ciclo
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("resumen_ciclos")
    .select("*");

  if (error) {
    console.error("[purgar GET]", error.message);
    return NextResponse.json(
      { error: "No se pudo leer el resumen de ciclos." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ciclos: data ?? [] });
}

// ------------------------------------------------- borrado masivo
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    ciclo?: string | null;
    confirmacion?: string;
  };

  const store = await cookies();
  const sesion = await leerSesion(
    store.get(COOKIE_ADMIN)?.value,
    process.env.ADMIN_SECRET
  );

  // Borrar toda la cartera es irreversible, así que exige escribir la frase.
  // Borrar un ciclo concreto exige escribir el nombre del ciclo.
  const esperado = body.ciclo ? body.ciclo : FRASE_PURGA;
  if ((body.confirmacion ?? "").trim() !== esperado) {
    return NextResponse.json(
      { error: `Para continuar escribe exactamente: ${esperado}` },
      { status: 400 }
    );
  }

  const consulta = supabaseAdmin.from("puntos_cartera").delete({ count: "exact" });

  const { count, error } = body.ciclo
    ? await consulta.eq("ciclo", body.ciclo)
    : await consulta.gt("id_registro", 0); // Supabase exige un filtro en DELETE

  if (error) {
    console.error("[purgar POST]", error.message);
    return NextResponse.json(
      { error: `No se pudo eliminar: ${error.message}` },
      { status: 500 }
    );
  }

  await supabaseAdmin.from("auditoria_cartera").insert({
    accion: "purgar",
    ciclo: body.ciclo ?? null,
    detalle: { eliminados: count ?? 0, alcance: body.ciclo ?? "toda la cartera" },
    hecho_por: sesion?.usuario ?? null,
  });

  return NextResponse.json({ ok: true, eliminados: count ?? 0 });
}
