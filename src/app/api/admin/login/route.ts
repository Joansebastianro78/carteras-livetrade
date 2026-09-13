import { NextResponse } from "next/server";
import { COOKIE_ADMIN, COOKIE_OPTS, crearToken } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const intentos = new Map<string, { n: number; hasta: number }>();

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "desconocida";
  const ahora = Date.now();
  const reg = intentos.get(ip);

  if (reg && reg.hasta > ahora && reg.n >= 8) {
    return NextResponse.json(
      { error: "Demasiados intentos. Espera cinco minutos." },
      { status: 429 }
    );
  }

  const { usuario, clave } = (await req.json().catch(() => ({}))) as {
    usuario?: string;
    clave?: string;
  };

  const secreto = process.env.ADMIN_SECRET;
  if (!secreto) {
    return NextResponse.json(
      { error: "Falta configurar ADMIN_SECRET en el servidor." },
      { status: 500 }
    );
  }

  function fallido() {
    intentos.set(ip, {
      n: (reg && reg.hasta > ahora ? reg.n : 0) + 1,
      hasta: ahora + 5 * 60_000,
    });
    // Mismo mensaje para usuario inexistente y clave errada: no confirmamos
    // cuáles usuarios existen.
    return NextResponse.json(
      { error: "Usuario o clave incorrectos." },
      { status: 401 }
    );
  }

  if (!usuario || !clave) return fallido();

  const { data, error } = await supabaseAdmin
    .rpc("verificar_admin", { p_usuario: usuario, p_clave: clave })
    .maybeSingle<{ usuario: string; nombre: string | null }>();

  if (error) {
    console.error("[login] error Supabase:", error.message);
    return NextResponse.json(
      { error: "No pudimos validar el acceso. Intenta de nuevo." },
      { status: 500 }
    );
  }

  if (!data) return fallido();

  intentos.delete(ip);
  const res = NextResponse.json({ ok: true, nombre: data.nombre ?? data.usuario });
  res.cookies.set(COOKIE_ADMIN, await crearToken(secreto, data.usuario), COOKIE_OPTS);
  return res;
}
