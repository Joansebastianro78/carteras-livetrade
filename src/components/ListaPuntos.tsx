"use client";

import { MapPin, Phone } from "lucide-react";
import { colorDeRuta, type PuntoCartera } from "@/lib/tipos";

type Props = {
  puntos: PuntoCartera[];
  seleccionado?: string | null;
  onSeleccionar?: (idPdv: string) => void;
};

export default function ListaPuntos({ puntos, seleccionado, onSeleccionar }: Props) {
  if (puntos.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-[var(--color-tinta-suave)]">
        No hay puntos para mostrar.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--color-linea)]">
      {puntos.map((p) => {
        const activo = seleccionado === p.id_pdv;
        return (
          <li key={p.id_pdv}>
            <button
              type="button"
              onClick={() => onSeleccionar?.(p.id_pdv)}
              aria-current={activo || undefined}
              className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                activo ? "bg-[#e4e9e6]" : "hover:bg-[#f3f5f2]"
              }`}
            >
              <span
                aria-hidden
                className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white cifras"
                style={{ background: colorDeRuta(p.ruta) }}
              >
                {p.ruta ?? ""}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--color-tinta)]">
                  {p.pdv ?? "Punto sin nombre"}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-[var(--color-tinta-suave)]">
                  {p.direccion ?? "Sin dirección registrada"}
                </span>

                <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-tinta-suave)]">
                  <span className="font-medium text-[var(--color-tinta)]">{p.que_hacer}</span>
                  {p.celular && (
                    <span className="inline-flex items-center gap-1 cifras">
                      <Phone size={12} aria-hidden /> {p.celular}
                    </span>
                  )}
                  {p.latitud === null && (
                    <span className="inline-flex items-center gap-1 text-[var(--color-alerta)]">
                      <MapPin size={12} aria-hidden /> sin ubicación
                    </span>
                  )}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
