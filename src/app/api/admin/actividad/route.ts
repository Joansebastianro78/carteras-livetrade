import { NextResponse } from "next/server";
import { leerActividad } from "@/lib/actividad";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Actividad reciente del panel, para el Inicio. Junta tres tablas:
 *   cargas_cartera     → cada carga de Excel (ya existía)
 *   auditoria_cartera  → ediciones, borrados y purgas de puntos (ya existía)
 *   actividad_panel    → todo lo demás (supabase/panel.sql)
 *
 * GET ?limite=8. Pide el módulo Inicio (src/lib/permisos.ts).
 */

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limite = Math.min(Math.max(Number(searchParams.get("limite")) || 8, 1), 50);
  return NextResponse.json(await leerActividad(limite));
}
