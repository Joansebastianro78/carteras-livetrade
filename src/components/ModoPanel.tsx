"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Monitor, Moon, Palette, Sun } from "lucide-react";
import {
  baseDe,
  COOKIE_MODO,
  DURACION_COOKIE_MODO_S,
  esModo,
  PALETAS,
  paletaDe,
  type Modo,
  type Paleta,
} from "@/lib/modo";

function cookieModo(): Modo {
  const par = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE_MODO}=`));
  return esModo(par?.slice(COOKIE_MODO.length + 1));
}

/** Pone en <html> el modo del que parte y, si hay, el tema de color. */
function aplicar(m: Modo) {
  const raiz = document.documentElement;
  raiz.dataset.modo = baseDe(m);
  const paleta = paletaDe(m);
  if (paleta) raiz.dataset.paleta = paleta.id;
  else delete raiz.dataset.paleta;
}

/**
 * El modo del panel. El servidor ya pintó <html data-modo data-paleta> con lo
 * que dice la cookie; esto lo mantiene al día cuando la persona lo cambia.
 *
 * Al salir del panel (por ejemplo, "Ver consulta" sin recargar la página) se
 * quitan, para que la consulta de los consultores siga clara.
 */
export function useModoPanel(inicial: Modo): [Modo, (m: Modo) => void] {
  const [modo, setModo] = useState<Modo>(inicial);

  useEffect(() => {
    const raiz = document.documentElement;
    // Si se llegó al panel sin recargar, el servidor no alcanzó a ponerlo.
    if (!raiz.dataset.modo) aplicar(cookieModo());
    return () => {
      delete raiz.dataset.modo;
      delete raiz.dataset.paleta;
    };
  }, []);

  const elegir = useCallback((m: Modo) => {
    document.cookie = `${COOKIE_MODO}=${m}; path=/; max-age=${DURACION_COOKIE_MODO_S}; samesite=lax`;
    aplicar(m);
    setModo(m);
  }, []);

  return [modo, elegir];
}

/** Para pantallas del panel que no tienen selector, como el login. */
export function AplicarModoPanel() {
  useModoPanel("claro");
  return null;
}

const OPCIONES: { id: Modo; nombre: string; Icono: typeof Sun }[] = [
  { id: "claro", nombre: "Claro", Icono: Sun },
  { id: "oscuro", nombre: "Oscuro", Icono: Moon },
  { id: "auto", nombre: "Auto", Icono: Monitor },
];

/** Muestra de un tema: su fondo, una tarjeta con una línea de texto y su color de acento. */
function Muestra({ paleta, grande = false }: { paleta: Paleta; grande?: boolean }) {
  const [fondo, papel, tinta, acento] = paleta.muestra;
  return (
    <span
      aria-hidden
      className={`relative block shrink-0 overflow-hidden rounded-[4px] border border-[var(--color-linea)] ${
        grande ? "h-7 w-9" : "h-4 w-5"
      }`}
      style={{ background: fondo }}
    >
      <span
        className="absolute rounded-[2px]"
        style={{ background: papel, inset: grande ? "4px 4px 4px 9px" : "3px 3px 3px 6px", border: `1px solid ${acento}55` }}
      />
      <span
        className="absolute rounded-full"
        style={{ background: acento, left: grande ? 3 : 2, top: grande ? 4 : 3, width: grande ? 4 : 3, height: grande ? 4 : 3 }}
      />
      {grande && (
        <>
          <span className="absolute h-[2px] rounded-full" style={{ background: tinta, left: 13, right: 8, top: 9 }} />
          <span className="absolute h-[2px] rounded-full" style={{ background: acento, left: 13, right: 14, top: 15 }} />
        </>
      )}
    </span>
  );
}

/**
 * Apariencia: tres botones (claro, oscuro o el del sistema) y, debajo, los
 * temas de color en un desplegable que se abre hacia arriba.
 */
export function SelectorModo({ modo, onElegir }: { modo: Modo; onElegir: (m: Modo) => void }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const idLista = useId();
  const paleta = paletaDe(modo);

  // Se cierra con Esc o tocando fuera.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Que no cierre también el menú del celular.
        e.stopPropagation();
        setAbierto(false);
        boton.current?.focus();
      }
    };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", tecla, true);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", tecla, true);
    };
  }, [abierto]);

  const grupos: { nombre: string; paletas: Paleta[] }[] = [
    { nombre: "Claros", paletas: PALETAS.filter((p) => p.base === "claro") },
    { nombre: "Oscuros", paletas: PALETAS.filter((p) => p.base === "oscuro") },
  ];

  return (
    <div ref={caja} className="relative">
      <p className="rotulo mb-1">Apariencia</p>
      <div
        role="group"
        aria-label="Apariencia del panel"
        className="grid grid-cols-3 gap-1 rounded-[6px] bg-[var(--color-relleno)] p-1"
      >
        {OPCIONES.map(({ id, nombre, Icono }) => {
          const activo = modo === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={activo}
              title={id === "auto" ? "Igual que el sistema" : `Modo ${nombre.toLowerCase()}`}
              onClick={() => onElegir(id)}
              className={`flex min-h-[30px] items-center justify-center gap-1.5 rounded-[4px] text-xs ${
                activo
                  ? "bg-[var(--color-papel)] font-semibold text-[var(--color-tinta)] shadow-[0_1px_2px_var(--color-sombra)]"
                  : "text-[var(--color-tinta-suave)] hover:text-[var(--color-tinta)]"
              }`}
            >
              <Icono size={14} aria-hidden />
              {nombre}
            </button>
          );
        })}
      </div>

      <button
        ref={boton}
        type="button"
        aria-expanded={abierto}
        aria-controls={idLista}
        onClick={() => setAbierto((v) => !v)}
        className={`mt-1.5 flex min-h-[34px] w-full items-center gap-2 rounded-[6px] px-2 text-left text-xs ${
          paleta
            ? "bg-[var(--color-relleno)] font-semibold text-[var(--color-tinta)]"
            : "text-[var(--color-tinta-suave)] hover:bg-[var(--color-hover)] hover:text-[var(--color-tinta)]"
        }`}
      >
        {paleta ? <Muestra paleta={paleta} /> : <Palette size={14} aria-hidden className="shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{paleta ? `Tema: ${paleta.nombre}` : "Temas de color"}</span>
        <ChevronDown size={14} aria-hidden className={`shrink-0 transition-transform ${abierto ? "rotate-180" : ""}`} />
      </button>

      {abierto && (
        <div
          id={idLista}
          role="group"
          aria-label="Temas de color"
          // En el celular se abre hacia arriba dentro del menú; en pantallas
          // grandes, al lado del menú lateral, que es angosto para los nombres.
          className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-[min(440px,70dvh)] overflow-y-auto rounded-[6px] border border-[var(--color-linea)] bg-[var(--color-papel)] p-2.5 shadow-[0_8px_24px_var(--color-sombra)] lg:fixed lg:inset-x-auto lg:bottom-4 lg:left-[268px] lg:mb-0 lg:w-[320px]"
        >
          {grupos.map((g) => (
            <div key={g.nombre} className="mb-2 last:mb-0">
              <p className="rotulo px-1 pb-1">{g.nombre}</p>
              <div className="grid grid-cols-2 gap-1">
                {g.paletas.map((p) => {
                  const activo = modo === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={activo}
                      onClick={() => onElegir(p.id as Modo)}
                      className={`flex min-h-[40px] items-center gap-2 rounded-[4px] border px-1.5 text-left text-xs ${
                        activo
                          ? "border-[var(--color-tinta)] bg-[var(--color-sutil)] font-semibold text-[var(--color-tinta)]"
                          : "border-transparent text-[var(--color-tinta-suave)] hover:bg-[var(--color-hover)] hover:text-[var(--color-tinta)]"
                      }`}
                    >
                      <Muestra paleta={p} grande />
                      <span className="min-w-0 flex-1 leading-tight">{p.nombre}</span>
                      {activo && <Check size={13} aria-hidden className="shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="px-1 pt-1 text-[11px] leading-snug text-[var(--color-tinta-suave)]">
            Para volver, elige Claro, Oscuro o Auto. Queda guardado en este navegador.
          </p>
        </div>
      )}
    </div>
  );
}
