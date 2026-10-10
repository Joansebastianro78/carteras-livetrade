"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  ExternalLink,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Rol } from "@/lib/auth";
import { fechaYHora } from "@/lib/fechas";
import { COOKIE_MENU, DURACION_COOKIE_MODO_S, type Modo } from "@/lib/modo";
import EncabezadoPagina from "./EncabezadoPagina";
import { SelectorModo, useModoPanel } from "./ModoPanel";

/**
 * Estructura común del panel de administración y del BackOffice: menú
 * lateral agrupado (en el celular, un menú que se despliega), barra superior
 * con la fecha y la hora y el estado de la página de consulta, y el contenido
 * de la sección elegida.
 *
 * La sección va en la dirección (#auditoria, #imagenes...): así un recargo o
 * un enlace deja a la persona donde estaba.
 *
 * En pantallas grandes el menú se puede ocultar para darle todo el ancho al
 * contenido (mapas, tablas); queda así en ese navegador hasta que se vuelva a
 * mostrar.
 */

export type Navegacion = { irA: (id: string) => void };

export type SeccionPanel = {
  id: string;
  /** Nombre en el menú. */
  menu: string;
  /** Título de la pantalla, si es distinto del nombre en el menú. */
  titulo?: string;
  /** Grupo del menú; null va arriba, sin rótulo. */
  grupo: string | null;
  Icono: LucideIcon;
  /** El componente pone su propio encabezado, con sus acciones. */
  encabezadoPropio?: boolean;
  descripcion?: string;
  /** "angosto" para pantallas de formulario. */
  ancho?: "amplio" | "angosto";
  render: (nav: Navegacion) => React.ReactNode;
};

type EstadoPagina = {
  ciclo: string | null;
  mantenimiento: { activo: boolean; hasta: string | null };
};

const NOMBRE_ROL: Record<Rol, string> = {
  superadmin: "Superadministrador",
  admin: "Administrador",
  backoffice: "BackOffice · solo consulta",
};

/**
 * Fecha y hora de Colombia en la barra de arriba: "Viernes, 9 de octubre · 7:15 p. m.".
 * Se pinta solo en el navegador (la hora del servidor no coincidiría con la de
 * la pantalla) y se pone al día cada pocos segundos.
 */
function Reloj() {
  const [ahora, setAhora] = useState<Date | null>(null);

  useEffect(() => {
    setAhora(new Date());
    const id = window.setInterval(() => setAhora(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  if (!ahora) return null;
  const { dia, hora } = fechaYHora(ahora);
  return (
    <time
      dateTime={ahora.toISOString()}
      className="cifras inline-flex min-h-[30px] items-center gap-2 rounded-full bg-[var(--color-relleno)] px-3 text-[13px]"
    >
      <Clock size={14} className="text-[var(--color-tinta-suave)]" aria-hidden />
      {dia}
      <span aria-hidden className="text-[var(--color-marcador)]">
        ·
      </span>
      {hora}
    </time>
  );
}

/** Dos letras para el círculo del usuario: "jsrodriguez@…" → "JS". */
function iniciales(usuario: string): string {
  const letras = usuario.split("@")[0].replace(/[^a-záéíóúñ]/gi, "");
  return (letras.slice(0, 2) || usuario.slice(0, 2)).toUpperCase();
}

export default function PanelShell({
  panel,
  usuario,
  rol,
  modo: modoInicial,
  menuOculto: menuOcultoInicial = false,
  secciones,
  inicial,
}: {
  panel: "admin" | "backoffice";
  usuario: string;
  rol: Rol;
  modo: Modo;
  /** El menú lateral oculto, como lo dejó la persona la última vez. */
  menuOculto?: boolean;
  secciones: SeccionPanel[];
  inicial: string;
}) {
  const router = useRouter();
  const [modo, elegirModo] = useModoPanel(modoInicial);
  const [activa, setActiva] = useState(inicial);
  /** La sección sale de la dirección, que solo se conoce en el navegador. */
  const [lista, setLista] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [menuOculto, setMenuOculto] = useState(menuOcultoInicial);
  const [estado, setEstado] = useState<EstadoPagina | null>(null);

  /** Oculta o muestra el menú lateral y lo recuerda en este navegador. */
  const ocultarMenu = useCallback((ocultar: boolean) => {
    setMenuOculto(ocultar);
    document.cookie = `${COOKIE_MENU}=${ocultar ? "oculto" : "visible"}; path=/; max-age=${DURACION_COOKIE_MODO_S}; samesite=lax`;
    // Los mapas de Leaflet solo se reacomodan cuando cambia el tamaño de la
    // ventana: se les avisa para que llenen el ancho nuevo sin quedar grises.
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }, []);

  // ------------------------------------------------------------ navegación
  useEffect(() => {
    const leer = () => {
      const pedida = decodeURIComponent(window.location.hash.slice(1));
      setActiva(secciones.some((s) => s.id === pedida) ? pedida : inicial);
      setLista(true);
      setMenuAbierto(false);
    };
    leer();
    window.addEventListener("hashchange", leer);
    return () => window.removeEventListener("hashchange", leer);
  }, [secciones, inicial]);

  // Cada sección empieza arriba, como una página nueva.
  const primeraVez = useRef(true);
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
  }, [activa]);

  const irA = useCallback((id: string) => {
    if (window.location.hash.slice(1) === id) return;
    window.location.hash = id;
  }, []);

  // ------------------------------------------------------- estado de la página
  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      fetch("/api/admin/resumen?corto=1")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (vivo && j) setEstado(j as EstadoPagina);
        })
        .catch(() => {});
    cargar();
    // Mantenimiento y Cargar plantilla avisan cuando cambian algo de esto.
    window.addEventListener("cartera:estado", cargar);
    return () => {
      vivo = false;
      window.removeEventListener("cartera:estado", cargar);
    };
  }, []);

  // ------------------------------------------------------------ menú del celular
  useEffect(() => {
    if (!menuAbierto) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuAbierto(false);
    };
    document.addEventListener("keydown", tecla);
    return () => {
      document.body.style.overflow = antes;
      document.removeEventListener("keydown", tecla);
    };
  }, [menuAbierto]);

  async function salir() {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    router.refresh();
  }

  const seccion = secciones.find((s) => s.id === activa) ?? secciones[0];
  const titulo = seccion.titulo ?? seccion.menu;
  const nav = useMemo(() => ({ irA }), [irA]);
  const enMantenimiento = estado?.mantenimiento.activo === true;

  const grupos = useMemo(() => {
    const lista: { nombre: string | null; secciones: SeccionPanel[] }[] = [];
    for (const s of secciones) {
      const g = lista.find((x) => x.nombre === s.grupo);
      if (g) g.secciones.push(s);
      else lista.push({ nombre: s.grupo, secciones: [s] });
    }
    return lista;
  }, [secciones]);

  const menu = (enCelular: boolean) => (
    <div className="flex min-h-full flex-col gap-5 px-3.5 pt-4 pb-4">
      <div className="flex items-center gap-2.5 px-2">
        <span
          aria-hidden
          className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[6px] text-[13px] font-bold tracking-wide ${
            panel === "admin"
              ? "bg-[var(--color-tinta)] text-[var(--color-sobre-tinta)]"
              : "bg-[var(--color-ambar)] text-[var(--color-sobre-ambar)]"
          }`}
        >
          LT
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold">Cartera LiveTrade</span>
          <span className="block text-xs text-[var(--color-tinta-suave)]">
            {panel === "admin" ? "Administración" : "BackOffice"}
          </span>
        </span>
        {enCelular ? (
          <button
            type="button"
            onClick={() => setMenuAbierto(false)}
            aria-label="Cerrar el menú"
            className="grid h-11 w-11 place-items-center rounded-[6px] text-[var(--color-tinta-suave)] hover:text-[var(--color-tinta)]"
          >
            <X size={20} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => ocultarMenu(true)}
            aria-label="Ocultar el menú"
            title="Ocultar el menú"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] text-[var(--color-tinta-suave)] hover:bg-[var(--color-hover)] hover:text-[var(--color-tinta)]"
          >
            <PanelLeftClose size={18} aria-hidden />
          </button>
        )}
      </div>

      <nav aria-label={panel === "admin" ? "Secciones del panel" : "Secciones del BackOffice"}>
        <div className="flex flex-col gap-4">
          {grupos.map((g) => (
            <div key={g.nombre ?? "-"} className="flex flex-col gap-0.5">
              {g.nombre && <p className="rotulo px-2.5 pb-1">{g.nombre}</p>}
              {g.secciones.map((s) => {
                const actual = s.id === seccion.id;
                return (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    aria-current={actual ? "page" : undefined}
                    onClick={() => setMenuAbierto(false)}
                    className={`flex min-h-[38px] items-center gap-2.5 rounded-[6px] px-2.5 text-[14px] ${
                      actual
                        ? "bg-[var(--color-relleno)] font-semibold text-[var(--color-tinta)]"
                        : "text-[var(--color-tinta-suave)] hover:bg-[var(--color-hover)] hover:text-[var(--color-tinta)]"
                    } ${enCelular ? "min-h-[44px]" : ""}`}
                  >
                    <s.Icono size={18} strokeWidth={1.75} aria-hidden className="shrink-0" />
                    {s.menu}
                  </a>
                );
              })}
            </div>
          ))}
        </div>
      </nav>

      <div className="mt-auto flex flex-col gap-3 border-t border-[var(--color-linea)] px-1.5 pt-3.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-[var(--color-relleno)] text-xs font-semibold"
          >
            {iniciales(usuario)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold" title={usuario}>
              {usuario}
            </span>
            <span className="block text-xs text-[var(--color-tinta-suave)]">{NOMBRE_ROL[rol]}</span>
          </span>
        </div>

        <SelectorModo modo={modo} onElegir={elegirModo} />

        <div className="flex gap-2">
          {panel === "admin" ? (
            // <a> y no <Link>: la consulta se carga de nuevo y queda sin modo oscuro.
            <a href="/" className="boton boton-secundario boton-chico flex-1">
              <ExternalLink size={14} aria-hidden />
              Ver consulta
            </a>
          ) : (
            rol !== "backoffice" && (
              <a href="/admin" className="boton boton-secundario boton-chico flex-1">
                Panel completo
              </a>
            )
          )}
          <button type="button" onClick={salir} className="boton boton-secundario boton-chico flex-1">
            <LogOut size={14} aria-hidden />
            Salir
          </button>
        </div>
      </div>
    </div>
  );

  const pildoraEstado = estado && (
    <>
      {(() => {
        const contenido = (
          <>
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${
                enMantenimiento ? "bg-[var(--color-ambar)]" : "bg-[var(--color-exito)]"
              }`}
            />
            {enMantenimiento ? "Consulta en mantenimiento" : "Consulta abierta"}
          </>
        );
        const clase = `inline-flex min-h-[30px] items-center gap-2 rounded-full px-3 text-[13px] font-medium ${
          enMantenimiento
            ? "bg-[var(--color-aviso-fondo)] text-[var(--color-aviso-tinta)]"
            : "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]"
        }`;
        return panel === "admin" ? (
          <a
            href="#mantenimiento"
            className={clase}
            title="La página donde los consultores consultan su cartera"
          >
            {contenido}
          </a>
        ) : (
          <span className={clase} title="La página donde los consultores consultan su cartera">
            {contenido}
          </span>
        );
      })()}
    </>
  );

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      {/* Menú fijo a la izquierda en pantallas grandes. */}
      {!menuOculto && (
        <aside className="hidden border-r border-[var(--color-linea)] bg-[var(--color-papel)] lg:sticky lg:top-0 lg:block lg:h-dvh lg:w-[256px] lg:shrink-0 lg:overflow-y-auto">
          {menu(false)}
        </aside>
      )}

      {/* En el celular, el menú se despliega encima del contenido. */}
      {menuAbierto && (
        <div className="fixed inset-0 z-[90] lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button
            type="button"
            aria-label="Cerrar el menú"
            onClick={() => setMenuAbierto(false)}
            className="absolute inset-0 h-full w-full bg-[var(--color-velo)]"
          />
          <aside className="absolute inset-y-0 left-0 w-[min(312px,86vw)] overflow-y-auto bg-[var(--color-papel)] shadow-[4px_0_18px_var(--color-sombra)]">
            {menu(true)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-[var(--color-linea)] bg-[var(--color-papel)]">
          <div className="flex min-h-[60px] items-center gap-2 px-2 lg:hidden">
            <button
              type="button"
              onClick={() => setMenuAbierto(true)}
              aria-label="Abrir el menú"
              aria-expanded={menuAbierto}
              className="grid h-12 w-12 place-items-center rounded-[6px]"
            >
              <Menu size={22} aria-hidden />
            </button>
            <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{seccion.menu}</span>
            {estado && (
              <span
                className={`mr-3 h-2.5 w-2.5 shrink-0 rounded-full ${
                  enMantenimiento ? "bg-[var(--color-ambar)]" : "bg-[var(--color-exito)]"
                }`}
                role="img"
                aria-label={enMantenimiento ? "Consulta en mantenimiento" : "Consulta abierta"}
              />
            )}
          </div>

          <div className="hidden min-h-[60px] flex-wrap items-center justify-between gap-3 px-10 lg:flex">
            <div className="flex items-center gap-3">
              {menuOculto && (
                <button
                  type="button"
                  onClick={() => ocultarMenu(false)}
                  aria-label="Mostrar el menú"
                  title="Mostrar el menú"
                  className="boton boton-secundario boton-chico -ml-4 gap-2"
                >
                  <PanelLeftOpen size={16} aria-hidden />
                  Menú
                </button>
              )}
              <p className="text-[13px] text-[var(--color-tinta-suave)]">
                {seccion.grupo ?? (panel === "admin" ? "Panel" : "BackOffice")}
                <span aria-hidden className="mx-2 text-[var(--color-marcador)]">
                  /
                </span>
                <span className="font-medium text-[var(--color-tinta)]">{titulo}</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Reloj />
              {pildoraEstado}
            </div>
          </div>
        </header>

        <main
          className={`mx-auto w-full px-4 pt-6 pb-24 sm:px-6 lg:px-10 lg:pt-8 lg:pb-14 ${
            seccion.ancho === "angosto"
              ? "max-w-[880px]"
              : menuOculto
                ? "max-w-[1600px]"
                : "max-w-[1260px]"
          }`}
        >
          {lista && (
            <>
              {!seccion.encabezadoPropio && (
                <EncabezadoPagina titulo={titulo} descripcion={seccion.descripcion} />
              )}
              <div key={seccion.id}>{seccion.render(nav)}</div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
