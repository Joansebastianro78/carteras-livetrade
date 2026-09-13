import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizarCedula, normalizarUsuario } from "@/lib/normalizar";
import type { PuntoCartera, RespuestaCartera } from "@/lib/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Limitador básico en memoria: frena la fuerza bruta sobre pares
 * usuario/cédula desde una misma IP. En producción con varias instancias,
 * reemplazar por Upstash Redis o el rate limiting del proveedor.
 */
const intentos = new Map<string, { n: number; hasta: number }>();
const VENTANA_MS = 60_000;
const MAX_POR_VENTANA = 20;

function limitado(ip: string): boolean {
  const ahora = Date.now();
  const reg = intentos.get(ip);
  if (!reg || reg.hasta < ahora) {
    intentos.set(ip, { n: 1, hasta: ahora + VENTANA_MS });
    return false;
  }
  reg.n += 1;
  return reg.n > MAX_POR_VENTANA;
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "desconocida";

  if (limitado(ip)) {
    return NextResponse.json(
      { error: "Demasiadas consultas seguidas. Espera un minuto e intenta de nuevo." },
      { status: 429 }
    );
  }

  let body: { usuario?: string; cedula?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Petición mal formada." }, { status: 400 });
  }

  const usuario = normalizarUsuario(body.usuario);
  const cedula = normalizarCedula(body.cedula);

  if (!usuario || !cedula) {
    return NextResponse.json(
      { error: "Escribe tu usuario y tu cédula para ver la cartera." },
      { status: 400 }
    );
  }

  // 'LIBRE' marca los puntos sin vendedor asignado: no es una credencial.
  if (usuario === "LIBRE" || cedula === "LIBRE") {
    return NextResponse.json(
      { error: "Ese usuario no tiene cartera asignada." },
      { status: 404 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("puntos_cartera")
    .select("*")
    .eq("usuario", usuario)
    .eq("ccuser", cedula)
    .order("ruta", { ascending: true })
    .order("pdv", { ascending: true });

  if (error) {
    console.error("[cartera] error Supabase:", error.message);
    return NextResponse.json(
      { error: "No pudimos consultar la base de datos. Intenta de nuevo." },
      { status: 500 }
    );
  }

  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "No encontramos puntos con ese usuario y esa cédula. Revisa los dos datos." },
      { status: 404 }
    );
  }

  const puntos = data as PuntoCartera[];
  const sinCoordenadas = puntos.filter(
    (p) => p.latitud === null || p.longitud === null
  ).length;

  const respuesta: RespuestaCartera = {
    puntos,
    vendedor: {
      usuario,
      nombre: puntos[0].nom ?? null,
      numDeRuta: puntos[0].num_de_ruta ?? null,
    },
    sinCoordenadas,
  };

  return NextResponse.json(respuesta);
}
