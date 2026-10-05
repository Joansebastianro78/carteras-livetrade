import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_ADMIN, leerSesion, mandaEnElPanel } from "@/lib/auth";

/**
 * Rutas de API que un perfil BackOffice sí puede usar. Todo lo demás bajo
 * /api/admin (cargar, editar, borrar, mantenimiento, usuarios) queda solo
 * para el rol admin.
 */
const API_BACKOFFICE = ["/api/admin/consultores", "/api/admin/logout"];

/**
 * Rutas que el perfil BackOffice puede LEER pero no cambiar. Los tableros de
 * Power BI los agrega un administrador; el BackOffice solo los consulta. El
 * filtro por departamento y ciudad solo tiene GET.
 */
const API_BACKOFFICE_LECTURA = ["/api/admin/tableros", "/api/admin/territorio"];

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
  if (!mandaEnElPanel(sesion.rol)) {
    if (pathname.startsWith("/admin")) {
      // Un BackOffice que llegue al panel completo se va a lo suyo.
      const url = req.nextUrl.clone();
      url.pathname = "/backoffice";
      url.search = "";
      return NextResponse.redirect(url);
    }

    const permitida =
      API_BACKOFFICE.some((ruta) => pathname.startsWith(ruta)) ||
      (req.method === "GET" &&
        API_BACKOFFICE_LECTURA.some((ruta) => pathname.startsWith(ruta)));

    if (pathname.startsWith("/api/admin") && !permitida) {
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
