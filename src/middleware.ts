import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_ADMIN, tokenValido } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // El login y el logout deben quedar accesibles.
  if (pathname.startsWith("/api/admin/login") || pathname.startsWith("/api/admin/logout")) {
    return NextResponse.next();
  }

  const ok = await tokenValido(
    req.cookies.get(COOKIE_ADMIN)?.value,
    process.env.ADMIN_SECRET
  );
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sesión no válida o expirada." }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/admin";
  url.searchParams.set("sesion", "expirada");
  // /admin renderiza el login cuando no hay cookie; evitamos un bucle de redirección.
  return pathname === "/admin" ? NextResponse.next() : NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
