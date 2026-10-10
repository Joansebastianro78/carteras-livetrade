"use client";

import { useCallback, useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { COOKIE_MODO, DURACION_COOKIE_MODO_S, esModo, type Modo } from "@/lib/modo";

function cookieModo(): Modo {
  const par = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE_MODO}=`));
  return esModo(par?.slice(COOKIE_MODO.length + 1));
}

/**
 * El modo del panel. El servidor ya pintó <html data-modo> con lo que dice la
 * cookie; esto lo mantiene al día cuando la persona lo cambia.
 *
 * Al salir del panel (por ejemplo, "Ver consulta" sin recargar la página) se
 * quita data-modo, para que la consulta de los consultores siga clara.
 */
export function useModoPanel(inicial: Modo): [Modo, (m: Modo) => void] {
  const [modo, setModo] = useState<Modo>(inicial);

  useEffect(() => {
    const raiz = document.documentElement;
    // Si se llegó al panel sin recargar, el servidor no alcanzó a ponerlo.
    if (!raiz.dataset.modo) raiz.dataset.modo = cookieModo();
    return () => {
      delete raiz.dataset.modo;
    };
  }, []);

  const elegir = useCallback((m: Modo) => {
    document.cookie = `${COOKIE_MODO}=${m}; path=/; max-age=${DURACION_COOKIE_MODO_S}; samesite=lax`;
    document.documentElement.dataset.modo = m;
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

/** Tres botones: claro, oscuro o el del sistema. */
export function SelectorModo({ modo, onElegir }: { modo: Modo; onElegir: (m: Modo) => void }) {
  return (
    <div>
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
    </div>
  );
}
