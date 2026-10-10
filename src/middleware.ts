import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_ADMIN, COOKIE_OPTS, leerSesion, mandaEnElPanel } from "@/lib/auth";
import { estadoEnBase } from "@/lib/estadoUsuario";
import { ENCABEZADO_PANEL } from "@/lib/modo";

/**
 * Rutas de API que un perfil BackOffice sí puede usar. Todo lo demás bajo
 * /api/admin (cargar, editar, borrar, mantenimiento, usuarios) queda solo
 * para el rol admin. Las dos auditorías necesitan POST para lanzar la consulta
 * en Athena, pero no cambian nada de la cartera; la revisión de fotos guarda
 * si una foto está bien o hay que revisarla, que es trabajo de la auditoría.
 */
const API_BACKOFFICE = [
  "/api/admin/consultores",
  "/api/admin/logout",
  "/api/admin/auditoria",
  "/api/admin/auditoria-imagenes",
  "/api/admin/revision-fotos",
  "/api/admin/asistente",
];

/**
 * Rutas que el perfil BackOffice puede LEER pero no cambiar. Los tableros de
 * Power BI los agrega un administrador; el BackOffice solo los consulta. El
 * filtro por departamento y ciudad y el resumen de la cartera solo tienen GET.
 */
const API_BACKOFFICE_LECTURA = [
  "/api/admin/tableros",
  "/api/admin/territorio",
  "/api/admin/resumen",
];

function esPaginaDelPanel(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/backoffice" ||
    pathname.startsWith("/backoffice/")
  );
}

/**
 * Deja pasar la petición. A las páginas del panel les marca un encabezado
 * para que el layout aplique el modo claro u oscuro; la consulta de los
 * consultores no pasa por aquí y se queda clara.
 */
function seguir(req: NextRequest) {
  if (!esPaginaDelPanel(req.nextUrl.pathname)) return NextResponse.next();
  const encabezados = new Headers(req.headers);
  encabezados.set(ENCABEZADO_PANEL, "1");
  return NextResponse.next({ request: { headers: encabezados } });
}

/**
 * La sesión ya no corresponde a lo que dice la base: le quitaron el perfil o
 * lo desactivaron. Se borra la cookie y se le pide volver a entrar.
 */
function sesionVencida(req: NextRequest, motivo: "perfil" | "inactiva") {
  const { pathname } = req.nextUrl;
  let res: NextResponse;

  if (pathname.startsWith("/api/")) {
    res = NextResponse.json(
      {
        error:
          motivo === "perfil"
            ? "Tu perfil cambió. Vuelve a entrar para seguir."
            : "Tu usuario ya no tiene acceso al panel.",
      },
      { status: 401 }
    );
  } else {
    const url = req.nextUrl.clone();
    url.pathname = pathname.startsWith("/backoffice") ? "/backoffice" : "/admin";
    url.search = "";
    url.searchParams.set("sesion", motivo);
    res = NextResponse.redirect(url);
  }

  res.cookies.set(COOKIE_ADMIN, "", { ...COOKIE_OPTS, maxAge: 0 });
  return res;
}

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
      return seguir(req);
    }

    const url = req.nextUrl.clone();
    url.pathname = pathname.startsWith("/backoffice") ? "/backoffice" : "/admin";
    url.searchParams.set("sesion", "expirada");
    return NextResponse.redirect(url);
  }

  // ------------------------------------------------- la base manda sobre la cookie
  const choca = (e: Awaited<ReturnType<typeof estadoEnBase>>) =>
    e === null || (e !== "desconocido" && e.rol !== sesion.rol);

  let enBase = await estadoEnBase(sesion.usuario);
  // Lo guardado en memoria puede ser de antes de que lo reactivaran o de que
  // entrara con el perfil nuevo: antes de sacarlo, se pregunta otra vez.
  if (choca(enBase)) enBase = await estadoEnBase(sesion.usuario, { fresco: true });

  if (enBase === null) return sesionVencida(req, "inactiva");
  if (enBase !== "desconocido" && enBase.rol !== sesion.rol) {
    return sesionVencida(req, "perfil");
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

  return seguir(req);
}

export const config = {
  matcher: ["/admin/:path*", "/backoffice/:path*", "/api/admin/:path*"],
};
