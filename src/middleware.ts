import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_ADMIN, leerSesion } from "@/lib/auth";

/**
 * Rutas de API que un perfil BackOffice sí puede usar. Todo lo demás bajo
 * /api/admin (cargar, editar, borrar, mantenimiento, usuarios) queda solo
 * para el rol admin.
 */
const API_BACKOFFICE = ["/api/admin/vendedores", "/api/admin/logout"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // El login y el logout deben quedar accesibles.
  if (
    pathname.startsWith("/api/admin/login") ||
    pathname.startsWith("/api/admin/logout")
  ) {
    return NextResponse.next();
  }

  const sesion = await leerSesion(
    req.cookies.get(COOKIE_ADMIN)?.value,
    process.env.ADMIN_SECRET
  );

  // ------------------------------------------------------------ sin sesión
  if (!sesion) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Sesión no válida o expirada." },
        { status: 401 }
      );
    }

    // /admin y /backoffice renderizan su propio login cuando no hay cookie;
    // entrar ahí no debe redirigir, o se arma un bucle.
    if (pathname === "/admin" || pathname === "/backoffice") {
      return NextResponse.next();
    }

    const url = req.nextUrl.clone();
    url.pathname = pathname.startsWith("/backoffice") ? "/backoffice" : "/admin";
    url.searchParams.set("sesion", "expirada");
    return NextResponse.redirect(url);
  }

  // ------------------------------------------------------------ con sesión
  if (sesion.rol !== "admin") {
    if (pathname.startsWith("/admin")) {
      // Un BackOffice que llegue al panel completo se va a lo suyo.
      const url = req.nextUrl.clone();
      url.pathname = "/backoffice";
      url.search = "";
      return NextResponse.redirect(url);
    }

    if (
      pathname.startsWith("/api/admin") &&
      !API_BACKOFFICE.some((ruta) => pathname.startsWith(ruta))
    ) {
      return NextResponse.json(
        { error: "Tu perfil BackOffice no tiene permiso para esta acción." },
        { status: 403 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/backoffice/:path*", "/api/admin/:path*"],
};
