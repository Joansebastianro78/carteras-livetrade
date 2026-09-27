import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PuntoCartera } from "@/lib/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_VENDEDORES = 40;

/**
 * BackOffice: buscar un vendedor y ver su cartera sin pedirle la contraseña.
 *
 *   GET ?q=texto                    → lista de vendedores que coinciden
 *   GET ?usuario=BAV006&ccuser=123  → la cartera completa de ese vendedor
 *
 * Va bajo /api/admin, así que el middleware ya exige sesión de administrador.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const usuario = (searchParams.get("usuario") ?? "").trim();
  const ccuser = (searchParams.get("ccuser") ?? "").trim();

  // ------------------------------------------------------------ detalle
  if (usuario && ccuser) {
    const { data, error } = await supabaseAdmin
      .from("puntos_cartera")
      .select("*")
      .eq("usuario", usuario)
      .eq("ccuser", ccuser)
      .order("num_de_ruta", { ascending: true })
      .order("ruta", { ascending: true })
      .order("pdv", { ascending: true });

    if (error) {
      console.error("[vendedores detalle]", error.message);
      return NextResponse.json(
        { error: "No se pudo leer la cartera de ese vendedor." },
        { status: 500 }
      );
    }

    const puntos = (data ?? []) as PuntoCartera[];

    if (puntos.length === 0) {
      return NextResponse.json(
        { error: "Ese vendedor ya no tiene puntos asignados." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      puntos,
      vendedor: {
        usuario,
        nombre: puntos.find((p) => p.nom)?.nom ?? null,
        numDeRuta: puntos.find((p) => p.num_de_ruta !== null)?.num_de_ruta ?? null,
        ccuser,
      },
      sinCoordenadas: puntos.filter((p) => p.latitud === null || p.longitud === null)
        .length,
    });
  }

  // ------------------------------------------------------------ búsqueda
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json(
      { error: "Escribe al menos dos caracteres para buscar." },
      { status: 400 }
    );
  }

  // PostgREST separa los filtros de .or() por comas y usa * como comodín.
  const limpio = q.replace(/[,()*%]/g, " ").trim();

  const { data, error } = await supabaseAdmin
    .from("resumen_vendedores")
    .select("*")
    .or(
      [
        `usuario.ilike.*${limpio}*`,
        `ccuser.ilike.*${limpio}*`,
        `nom.ilike.*${limpio}*`,
      ].join(",")
    )
    .limit(MAX_VENDEDORES);

  if (error) {
    console.error("[vendedores buscar]", error.message);

    const faltaVista = /does not exist|schema cache/i.test(error.message);
    return NextResponse.json(
      {
        error: faltaVista
          ? "Falta la vista resumen_vendedores. Ejecuta supabase/gestion.sql en el SQL Editor."
          : "Falló la búsqueda de vendedores.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ vendedores: data ?? [], tope: MAX_VENDEDORES });
}
