import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_ADMIN, COOKIE_OPTS, leerSesion } from "@/lib/auth";
import { estadoEnBase, type EstadoUsuario } from "@/lib/estadoUsuario";
import { ENCABEZADO_PANEL } from "@/lib/modo";
import { modulosEfectivos, puedeUsarRuta } from "@/lib/permisos";

/**
 * Qué puede usar cada perfil lo dice src/lib/permisos.ts: cada ruta de
 * /api/admin pide un módulo y el perfil lo tiene o no. Las páginas /admin y
 * /backoffice muestran solo los módulos del perfil, pero el permiso de verdad
 * se revisa aquí: esconder un botón no basta.
 */

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

/** Por qué ya no sirve la sesión, o null si sigue bien. */
function motivoParaSacar(e: EstadoUsuario, rol: string): "perfil" | "inactiva" | null {
  if (e === null) return "inactiva";
  if (e !== "desconocido" && e.rol !== rol) return "perfil";
  return null;
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
  const esApi = pathname.startsWith("/api/admin/");
  const permite = (e: EstadoUsuario) =>
    puedeUsarRuta(
      modulosEfectivos(sesion.rol, e === null || e === "desconocido" ? null : e.modulos),
      sesion.rol,
      pathname,
      req.method,
      req.nextUrl.searchParams
    );

  let enBase = await estadoEnBase(sesion.usuario);

  // Lo guardado en memoria puede ser de antes de que lo reactivaran, de que
  // entrara con el perfil nuevo o de que le dieran el permiso: antes de
  // sacarlo o de negarle algo, se pregunta otra vez.
  if (
    enBase !== "desconocido" &&
    (motivoParaSacar(enBase, sesion.rol) !== null || (esApi && !permite(enBase)))
  ) {
    enBase = await estadoEnBase(sesion.usuario, { fresco: true });
  }

  const motivo = motivoParaSacar(enBase, sesion.rol);
  if (motivo) return sesionVencida(req, motivo);

  // ------------------------------------------------------------ permisos
  if (esApi && !permite(enBase)) {
    return NextResponse.json(
      { error: "Tu perfil no tiene permiso para esto. Pídeselo a un administrador." },
      { status: 403 }
    );
  }

  return seguir(req);
}

export const config = {
  matcher: ["/admin/:path*", "/backoffice/:path*", "/api/admin/:path*"],
};
