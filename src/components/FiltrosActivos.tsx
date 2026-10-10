"use client";

import { X } from "lucide-react";

export type FiltroActivo = { id: string; etiqueta: string; quitar: () => void };

/**
 * Los filtros puestos, cada uno con su X para quitarlo, y una nota a la
 * derecha (qué trae el Excel).
 */
export default function FiltrosActivos({
  filtros,
  onQuitarTodo,
  nota,
}: {
  filtros: FiltroActivo[];
  onQuitarTodo: () => void;
  nota?: React.ReactNode;
}) {
  if (filtros.length === 0 && !nota) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-linea)] pt-3">
      {filtros.length > 0 && (
        <span className="text-xs text-[var(--color-tinta-suave)]">Filtrando por</span>
      )}
      {filtros.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={f.quitar}
          aria-label={`Quitar el filtro: ${f.etiqueta}`}
          className="chip min-h-[30px] max-w-full border-[var(--color-tinta)] pr-2"
        >
          <span className="truncate">{f.etiqueta}</span>
          <X size={14} aria-hidden className="shrink-0" />
        </button>
      ))}
      {filtros.length > 1 && (
        <button
          type="button"
          onClick={onQuitarTodo}
          className="min-h-[30px] px-1 text-[13px] underline underline-offset-2"
        >
          Quitar filtros
        </button>
      )}
      {nota && (
        <span className="cifras text-xs leading-relaxed text-[var(--color-tinta-suave)] sm:ml-auto">
          {nota}
        </span>
      )}
    </div>
  );
}
