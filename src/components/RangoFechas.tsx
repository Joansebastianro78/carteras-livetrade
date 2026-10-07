"use client";

import { TriangleAlert } from "lucide-react";
import {
  SIN_RANGO,
  diaCorto,
  hayRango,
  rangoAlReves,
  type Rango,
  type ResumenFechas,
} from "@/lib/fechas";
import { cifra } from "./ConsultaAthena";

/**
 * Los campos «Desde» y «Hasta» de las auditorías, con lo que hay que saber
 * para usarlos: entre qué días hay datos, cuántas filas no traen fecha y el
 * aviso si el rango quedó al revés. Filtrar es cosa de cada pestaña.
 *
 * El calendario solo ofrece los días en que hay datos. Un campo no limita al
 * otro, para poder mover el rango sin pelear con él.
 */
export default function RangoFechas({
  id,
  rango,
  onCambiar,
  fechas,
  uno,
  varios,
  femenino = false,
  columna = "fecha",
}: {
  /** Prefijo de los id de los campos: `${id}-desde` y `${id}-hasta`. */
  id: string;
  rango: Rango;
  onCambiar: (rango: Rango) => void;
  fechas: ResumenFechas;
  /** Cómo se llama una fila en esta pestaña: "visita", "hallazgo". */
  uno: string;
  varios: string;
  femenino?: boolean;
  /** Cómo se llama la fecha en esta pestaña: "fecha", "fecha de inicio". */
  columna?: string;
}) {
  const conRango = hayRango(rango);
  const limites = { min: fechas.primera || undefined, max: fechas.ultima || undefined };

  return (
    <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-desde`} className="campo-etiqueta">
            Desde
          </label>
          <input
            id={`${id}-desde`}
            type="date"
            value={rango.desde}
            {...limites}
            onChange={(e) => onCambiar({ ...rango, desde: e.target.value })}
            className="campo cifras"
          />
        </div>
        <div>
          <label htmlFor={`${id}-hasta`} className="campo-etiqueta">
            Hasta
          </label>
          <input
            id={`${id}-hasta`}
            type="date"
            value={rango.hasta}
            {...limites}
            onChange={(e) => onCambiar({ ...rango, hasta: e.target.value })}
            className="campo cifras"
          />
        </div>
      </div>

      <p className="cifras mt-1.5 text-xs leading-relaxed text-[var(--color-tinta-suave)]">
        {fechas.primera
          ? fechas.primera === fechas.ultima
            ? `${femenino ? "Todas las" : "Todos los"} ${varios} son del ${diaCorto(fechas.primera)}.`
            : `Hay ${varios} del ${diaCorto(fechas.primera)} al ${diaCorto(fechas.ultima)}.`
          : fechas.ilegible
            ? `No se pudo leer la ${columna} de ${femenino ? "las" : "los"} ${varios} (llega como «${fechas.ilegible.slice(0, 40)}»), así que no se pueden filtrar por fecha.`
            : `${femenino ? "Las" : "Los"} ${varios} no traen ${columna}.`}
        {conRango && (
          <>
            {" "}
            <button
              type="button"
              onClick={() => onCambiar(SIN_RANGO)}
              className="text-[var(--color-tinta)] underline underline-offset-2"
            >
              Quitar fechas
            </button>
          </>
        )}
      </p>

      {rangoAlReves(rango) && (
        <p
          role="alert"
          className="mt-2 flex items-center gap-2 rounded-[4px] bg-[#f8ecea] px-3 py-2 text-[13px] text-[var(--color-alerta)]"
        >
          <TriangleAlert size={14} className="shrink-0" aria-hidden />
          «Desde» es posterior a «Hasta»: así {femenino ? "ninguna" : "ningún"} {uno} entra en el
          rango.
        </p>
      )}

      {conRango && fechas.sinFecha > 0 && (
        <p className="cifras mt-2 text-xs text-[var(--color-tinta-suave)]">
          {fechas.sinFecha === 1
            ? `1 ${uno} no trae fecha y queda fuera de cualquier rango.`
            : `${cifra(fechas.sinFecha)} ${varios} no traen fecha y quedan fuera de cualquier rango.`}
        </p>
      )}
    </>
  );
}
