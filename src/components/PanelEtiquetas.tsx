"use client";

import { Loader2, ScanSearch, TriangleAlert } from "lucide-react";
import { nombreEtiqueta } from "@/lib/etiquetasIA";
import { cifra } from "./ConsultaAthena";
import type { EtiquetasIA } from "./useEtiquetasIA";

/** Los filtros de lo que vio la IA: una etiqueta, «ninguna», «ilegible» o «sin revisar». */
export const NINGUNA = "\u0000ninguna";
export const ILEGIBLES = "\u0000ilegible";
export const SIN_REVISAR = "\u0000sin-revisar";

export type CuentasIA = { porEtiqueta: [string, number][]; ninguna: number; ilegibles: number; sinRevisar: number };

/**
 * Qué se ve en las fotos, dentro de los filtros de la galería: qué buscar, el
 * botón para que la IA revise las fotos filtradas, el avance y los filtros por
 * lo que vio.
 */
export default function PanelEtiquetas({
  e,
  pendientes,
  cuentas,
  filtro,
  onFiltro,
  onRevisar,
}: {
  e: EtiquetasIA;
  /** Fotos de las visitas filtradas que faltan por revisar. */
  pendientes: number;
  cuentas: CuentasIA;
  filtro: string;
  onFiltro: (valor: string) => void;
  onRevisar: () => void;
}) {
  const revisando = e.estado.tipo === "revisando";
  const hayResultados = cuentas.porEtiqueta.some(([, n]) => n > 0) || cuentas.ninguna > 0 || cuentas.ilegibles > 0;

  const chips: { id: string; nombre: string; n: number }[] = [
    ...cuentas.porEtiqueta.map(([et, n]) => ({ id: et, nombre: nombreEtiqueta(et), n })),
    { id: NINGUNA, nombre: "Ninguna", n: cuentas.ninguna },
    ...(cuentas.ilegibles > 0 ? [{ id: ILEGIBLES, nombre: "Ilegible", n: cuentas.ilegibles }] : []),
    ...(cuentas.sinRevisar > 0 || filtro === SIN_REVISAR ? [{ id: SIN_REVISAR, nombre: "Sin revisar", n: cuentas.sinRevisar }] : []),
  ];

  return (
    <section aria-label="Qué se ve en las fotos" className="space-y-2.5 border-t border-[var(--color-linea)] pt-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2.5">
        <div className="min-w-0 flex-1 basis-72">
          <label htmlFor="fotos-ia-etiquetas" className="text-[14px] font-semibold">
            Qué se ve en las fotos
          </label>
          <p className="mb-1.5 text-[12.5px] leading-snug text-[var(--color-tinta-suave)]">
            Escribe qué buscar, separado por comas. La IA revisa las fotos que quedan con los filtros puestos.
          </p>
          <input
            id="fotos-ia-etiquetas"
            value={e.texto}
            onChange={(ev) => e.setTexto(ev.target.value)}
            disabled={revisando}
            placeholder="libro, afiche, persona"
            autoComplete="off"
            className="campo"
          />
        </div>
        {revisando ? (
          <button type="button" onClick={e.detener} className="boton boton-secundario">
            Detener
          </button>
        ) : (
          <button
            type="button"
            onClick={onRevisar}
            disabled={pendientes === 0 || e.etiquetas.length === 0}
            className="boton boton-secundario"
          >
            <ScanSearch size={15} aria-hidden />
            {pendientes === 0 ? "Todo revisado" : `Revisar con IA (${cifra(pendientes)} ${pendientes === 1 ? "foto" : "fotos"})`}
          </button>
        )}
      </div>

      {e.estado.tipo === "revisando" && (
        <div className="space-y-1.5" role="status">
          <p className="cifras flex items-center gap-1.5 text-[12.5px] text-[var(--color-tinta-suave)]">
            <Loader2 size={13} className="animate-spin" aria-hidden />
            {e.estado.esperando
              ? `Gemini pidió una pausa: sigue solo en ${cifra(e.estado.esperando)} s… (${cifra(e.estado.hechas)} de ${cifra(e.estado.total)})`
              : `La IA está revisando las fotos… ${cifra(e.estado.hechas)} de ${cifra(e.estado.total)}`}
          </p>
          <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-relleno)]" aria-hidden>
            <span
              className="block h-full bg-[var(--color-tinta)] transition-[width]"
              style={{ width: `${e.estado.total ? (e.estado.hechas / e.estado.total) * 100 : 0}%` }}
            />
          </span>
        </div>
      )}

      {(hayResultados || filtro) && (
        <div role="group" aria-label="Lo que vio la IA" className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={filtro === c.id}
              onClick={() => onFiltro(filtro === c.id ? "" : c.id)}
              className="chip"
            >
              {c.nombre}
              <span className="cifras opacity-75">{cifra(c.n)}</span>
            </button>
          ))}
        </div>
      )}

      {[e.estado.tipo === "error" ? e.estado.mensaje : null, e.aviso]
        .filter((m): m is string => Boolean(m))
        .map((m) => (
          <p
            key={m}
            className="flex items-start gap-2 rounded-[4px] bg-[var(--color-aviso-fondo)] px-3 py-2 text-[12.5px] leading-snug text-[var(--color-aviso-tinta)]"
          >
            <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
            {m}
          </p>
        ))}
    </section>
  );
}
