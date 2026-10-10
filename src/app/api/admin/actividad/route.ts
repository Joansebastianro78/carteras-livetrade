import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { esTablaFaltante, textoError } from "@/lib/tablaFaltante";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Actividad reciente del panel, para el Inicio. Junta tres tablas:
 *   cargas_cartera     → cada carga de Excel (ya existía)
 *   auditoria_cartera  → ediciones, borrados y purgas de puntos (ya existía)
 *   actividad_panel    → todo lo demás (supabase/panel.sql)
 *
 * GET ?limite=8. Solo administradores: el middleware no se la abre al BackOffice.
 */

type ItemActividad = {
  momento: string;
  usuario: string | null;
  accion: string;
  detalle: Record<string, unknown> | null;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limite = Math.min(Math.max(Number(searchParams.get("limite")) || 8, 1), 50);

  const [cargas, cambios, panel] = await Promise.all([
    supabaseAdmin
      .from("cargas_cartera")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limite),
    supabaseAdmin
      .from("auditoria_cartera")
      .select("accion,id_pdv,ciclo,detalle,hecho_por,created_at")
      .order("created_at", { ascending: false })
      .limit(limite),
    supabaseAdmin
      .from("actividad_panel")
      .select("usuario,accion,detalle,created_at")
      .order("created_at", { ascending: false })
      .limit(limite),
  ]);

  const items: ItemActividad[] = [];

  if (cargas.error) console.error("[actividad cargas]", cargas.error.message);
  for (const c of cargas.data ?? []) {
    items.push({
      momento: c.created_at,
      usuario: c.cargado_por ?? null,
      accion: "cargar",
      detalle: {
        archivo: c.archivo,
        modo: c.modo ?? null,
        filas: c.filas_ok,
        observaciones: c.filas_error ?? 0,
      },
    });
  }

  if (cambios.error) console.error("[actividad cambios]", cambios.error.message);
  for (const c of cambios.data ?? []) {
    items.push({
      momento: c.created_at,
      usuario: c.hecho_por ?? null,
      accion: c.accion,
      detalle: {
        ...((c.detalle as Record<string, unknown> | null) ?? {}),
        id_pdv: c.id_pdv,
        ciclo: c.ciclo,
      },
    });
  }

  // Sin panel.sql la tabla no existe: se avisa, pero lo demás sigue saliendo.
  let aviso: string | null = null;
  if (panel.error) {
    console.error("[actividad panel]", textoError(panel.error, panel.status));
    aviso = esTablaFaltante(panel.error, panel.status)
      ? "Para ver también los cambios de usuarios, mantenimiento, tableros y temas, ejecuta supabase/panel.sql en el SQL Editor."
      : null;
  }
  for (const a of panel.data ?? []) {
    items.push({
      momento: a.created_at,
      usuario: a.usuario ?? null,
      accion: a.accion,
      detalle: (a.detalle as Record<string, unknown> | null) ?? null,
    });
  }

  items.sort((a, b) => Date.parse(b.momento) - Date.parse(a.momento));

  return NextResponse.json({ actividad: items.slice(0, limite), aviso });
}
