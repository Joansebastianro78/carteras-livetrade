import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_ADMIN, leerSesion } from "@/lib/auth";
import { PATRON_CLAVE } from "@/lib/revisionFotos";
import { esTablaFaltante, textoError } from "@/lib/tablaFaltante";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Revisión de las fotos de la auditoría de imágenes (tabla revision_fotos,
 * en supabase/panel.sql). La pueden usar los tres perfiles: revisar fotos es
 * trabajo de la auditoría y no cambia nada de la cartera. Queda guardado
 * quién marcó cada una.
 *
 *   GET                                        → todas las revisiones
 *   POST { clave, estado, cod, usuario, fecha, foto }
 *        estado: "correcta" | "revisar" | null (null quita la marca)
 */

const AVISO_SIN_TABLA =
  "Para marcar fotos falta la tabla revision_fotos. Ejecuta supabase/panel.sql en el SQL Editor.";

/** Recorta un texto opcional antes de guardarlo. */
function texto(valor: unknown, largo: number): string | null {
  if (typeof valor !== "string") return null;
  const t = valor.trim();
  return t ? t.slice(0, largo) : null;
}

export async function GET() {
  const revisiones: {
    clave: string;
    estado: string;
    revisado_por: string | null;
    actualizado: string | null;
  }[] = [];

  // Supabase entrega de a 1000 filas por consulta.
  for (let desde = 0; desde < 100_000; desde += 1000) {
    const { data, error, status } = await supabaseAdmin
      .from("revision_fotos")
      .select("clave,estado,revisado_por,updated_at")
      .order("clave", { ascending: true })
      .range(desde, desde + 999);

    if (error) {
      console.error("[revision-fotos GET]", textoError(error, status));
      if (esTablaFaltante(error, status)) {
        return NextResponse.json({ revisiones: [], aviso: AVISO_SIN_TABLA });
      }
      return NextResponse.json({ error: "No se pudieron leer las revisiones." }, { status: 500 });
    }

    for (const r of data ?? []) {
      revisiones.push({
        clave: r.clave,
        estado: r.estado,
        revisado_por: r.revisado_por,
        actualizado: r.updated_at,
      });
    }
    if (!data || data.length < 1000) break;
  }

  return NextResponse.json({ revisiones, aviso: null });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const clave = typeof body.clave === "string" ? body.clave : "";
  const estado = body.estado ?? null;

  if (!PATRON_CLAVE.test(clave)) {
    return NextResponse.json({ error: "Falta la foto que se quiere marcar." }, { status: 400 });
  }
  if (estado !== null && estado !== "correcta" && estado !== "revisar") {
    return NextResponse.json({ error: "Marca no válida." }, { status: 400 });
  }

  const store = await cookies();
  const sesion = await leerSesion(store.get(COOKIE_ADMIN)?.value, process.env.ADMIN_SECRET);

  if (estado === null) {
    const { error, status } = await supabaseAdmin
      .from("revision_fotos")
      .delete()
      .eq("clave", clave);
    if (error) {
      console.error("[revision-fotos quitar]", textoError(error, status));
      const falta = esTablaFaltante(error, status);
      return NextResponse.json(
        { error: falta ? AVISO_SIN_TABLA : "No se pudo quitar la marca." },
        { status: falta ? 503 : 500 }
      );
    }
    return NextResponse.json({ ok: true, revision: null });
  }

  const fila = {
    clave,
    estado,
    cod_personalizado: texto(body.cod, 80),
    nombre_usuario: texto(body.usuario, 120),
    fecha_inicio: texto(body.fecha, 40),
    foto: texto(body.foto, 2000),
    revisado_por: sesion?.usuario ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error, status } = await supabaseAdmin
    .from("revision_fotos")
    .upsert(fila, { onConflict: "clave" });
  if (error) {
    console.error("[revision-fotos marcar]", textoError(error, status));
    const falta = esTablaFaltante(error, status);
    return NextResponse.json(
      { error: falta ? AVISO_SIN_TABLA : "No se pudo guardar la marca." },
      { status: falta ? 503 : 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    revision: { estado, revisado_por: fila.revisado_por, actualizado: fila.updated_at },
  });
}
