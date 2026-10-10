import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Antes de aplicar una carga: cuántas filas del archivo ya existen en la
 * cartera y cuántas serían nuevas. No cambia nada.
 *
 *   POST { claves: [{ id, ciclo }], tieneCiclo }  (hasta 1000 claves)
 *   → { existen, nuevas }
 *
 * Usa la misma llave que /api/admin/upload: con columna CICLO, ID + ciclo;
 * sin ella, el ID en cualquier ciclo.
 */

const MAX_CLAVES = 1000;
/** Los ID van en la dirección de la consulta a Supabase: de a poco. */
const TAM_TRAMO = 200;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    claves?: { id?: unknown; ciclo?: unknown }[];
    tieneCiclo?: boolean;
  };

  const claves = (Array.isArray(body.claves) ? body.claves : [])
    .filter((c) => typeof c?.id === "string" && c.id.length > 0)
    .map((c) => ({ id: c.id as string, ciclo: typeof c.ciclo === "string" ? c.ciclo : "" }));

  if (claves.length === 0) {
    return NextResponse.json({ error: "No llegaron filas para revisar." }, { status: 400 });
  }
  if (claves.length > MAX_CLAVES) {
    return NextResponse.json({ error: `Máximo ${MAX_CLAVES} filas por consulta.` }, { status: 413 });
  }

  const ids = [...new Set(claves.map((c) => c.id))];
  const existentes = new Set<string>();

  for (let i = 0; i < ids.length; i += TAM_TRAMO) {
    const { data, error } = await supabaseAdmin
      .from("puntos_cartera")
      .select("id_pdv,ciclo")
      .in("id_pdv", ids.slice(i, i + TAM_TRAMO));

    if (error) {
      console.error("[upload previa]", error.message);
      return NextResponse.json({ error: "No se pudo consultar la cartera." }, { status: 500 });
    }
    for (const e of data ?? []) {
      existentes.add(body.tieneCiclo ? `${e.id_pdv}|${e.ciclo}` : e.id_pdv);
    }
  }

  let existen = 0;
  for (const c of claves) {
    if (existentes.has(body.tieneCiclo ? `${c.id}|${c.ciclo}` : c.id)) existen++;
  }

  return NextResponse.json({ existen, nuevas: claves.length - existen });
}
