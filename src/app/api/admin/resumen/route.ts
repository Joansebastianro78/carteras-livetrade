import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { filtroLibres, leerBaseResumen, leerResumenCartera } from "@/lib/resumenCartera";
import { CAMPOS_TERRITORIO, type PuntoTerritorio } from "@/lib/territorio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cómo está la cartera hoy.
 *
 *   GET ?corto=1                    → ciclo actual, ciclos y mantenimiento (barra del panel)
 *   GET                             → lo anterior y además: las cifras de toda la
 *                                     cartera, todos los ciclos (general: puntos,
 *                                     asignados, LIBRE, consultores con puntos y sin
 *                                     coordenadas), las dos últimas cargas y los
 *                                     puntos por departamento, también de toda la
 *                                     cartera
 *   GET ?lista=sin-ubicacion|libres → los puntos de toda la cartera sin coordenadas
 *                                     o sin consultor, para descargarlos
 *
 * El ciclo actual es el que se tocó más recientemente.
 * Solo GET. ?corto=1 lo lee cualquiera con sesión; lo demás pide «Inicio» o
 * «Cargar plantilla» (src/lib/permisos.ts).
 */

const TOPE_LISTA = 10_000;

async function lista(tipo: string) {
  const puntos: PuntoTerritorio[] = [];

  for (let desde = 0; desde < TOPE_LISTA; desde += 1000) {
    let consulta = supabaseAdmin.from("puntos_cartera").select(CAMPOS_TERRITORIO);

    consulta = tipo === "libres" ? filtroLibres(consulta) : consulta.is("latitud", null);

    const { data, error } = await consulta
      .order("ciclo", { ascending: true })
      .order("id_pdv", { ascending: true })
      .range(desde, desde + 999);

    if (error) {
      console.error("[resumen lista]", error.message);
      return NextResponse.json({ error: "No se pudieron leer los puntos." }, { status: 500 });
    }

    puntos.push(...((data ?? []) as unknown as PuntoTerritorio[]));
    if (!data || data.length < 1000) break;
  }

  return NextResponse.json({ puntos });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const tipoLista = searchParams.get("lista");
  if (tipoLista) {
    if (tipoLista !== "sin-ubicacion" && tipoLista !== "libres") {
      return NextResponse.json({ error: "Lista desconocida." }, { status: 400 });
    }
    return lista(tipoLista);
  }

  const previo = await leerBaseResumen();
  if (searchParams.get("corto")) return NextResponse.json(previo.base);

  return NextResponse.json(await leerResumenCartera(previo));
}
