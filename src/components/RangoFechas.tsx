"use client";

import { useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import {
  atajoDeRango,
  diaCorto,
  hayRango,
  rangoAlReves,
  rangoDeAtajo,
  type Atajo,
  type Rango,
  type ResumenFechas,
} from "@/lib/fechas";
import { cifra } from "./ConsultaAthena";

const ATAJOS: { id: Atajo; nombre: string }[] = [
  { id: "todo", nombre: "Todo" },
  { id: "hoy", nombre: "Hoy" },
  { id: "siete", nombre: "Últimos 7 días" },
  { id: "mes", nombre: "Este mes" },
  { id: "personalizado", nombre: "Personalizado" },
];

/**
 * Filtro de fechas de las auditorías: atajos (hoy, últimos 7 días, este mes)
 * y los campos «Desde» y «Hasta», con lo que hay que saber para usarlos:
 * entre qué días hay datos, cuántas filas no traen fecha y el aviso si el
 * rango quedó al revés. Filtrar es cosa de cada pestaña.
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
  // "Hoy" se calcula en el navegador, no en el servidor.
  const [hoy, setHoy] = useState<Date | null>(null);
  useEffect(() => setHoy(new Date()), []);

  const desde = useRef<HTMLInputElement>(null);
  const conRango = hayRango(rango);
  const atajo: Atajo = hoy ? atajoDeRango(rango, hoy) : conRango ? "personalizado" : "todo";
  const limites = { min: fechas.primera || undefined, max: fechas.ultima || undefined };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <span className="text-[13px] font-semibold">Fechas</span>
        <div
          role="group"
          aria-label="Rango de fechas"
          className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 py-0.5"
        >
          {ATAJOS.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={atajo === a.id}
              onClick={() => {
                if (a.id === "personalizado") {
                  desde.current?.focus();
                  return;
                }
                onCambiar(rangoDeAtajo(a.id, hoy ?? new Date()));
              }}
              className="chip"
            >
              {a.nombre}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
          <label htmlFor={`${id}-desde`} className="text-[13px] text-[var(--color-tinta-suave)]">
            Desde
          </label>
          <div className="w-[158px]">
            <input
              ref={desde}
              id={`${id}-desde`}
              type="date"
              value={rango.desde}
              {...limites}
              onChange={(e) => onCambiar({ ...rango, desde: e.target.value })}
              className="campo cifras"
            />
          </div>
          <label htmlFor={`${id}-hasta`} className="text-[13px] text-[var(--color-tinta-suave)]">
            Hasta
          </label>
          <div className="w-[158px]">
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
      </div>

      <p className="cifras mt-2 text-xs leading-relaxed text-[var(--color-tinta-suave)]">
        {fechas.primera
          ? fechas.primera === fechas.ultima
            ? `${femenino ? "Todas las" : "Todos los"} ${varios} son del ${diaCorto(fechas.primera)}.`
            : `Hay ${varios} del ${diaCorto(fechas.primera)} al ${diaCorto(fechas.ultima)}.`
          : fechas.ilegible
            ? `No se pudo leer la ${columna} de ${femenino ? "las" : "los"} ${varios} (llega como «${fechas.ilegible.slice(0, 40)}»), así que no se pueden filtrar por fecha.`
            : `${femenino ? "Las" : "Los"} ${varios} no traen ${columna}.`}
        {conRango &&
          fechas.sinFecha > 0 &&
          (fechas.sinFecha === 1
            ? ` 1 ${uno} no trae fecha y queda fuera de cualquier rango.`
            : ` ${cifra(fechas.sinFecha)} ${varios} no traen fecha y quedan fuera de cualquier rango.`)}
      </p>

      {rangoAlReves(rango) && (
        <p
          role="alert"
          className="mt-2 flex items-center gap-2 rounded-[4px] bg-[var(--color-alerta-fondo)] px-3 py-2 text-[13px] text-[var(--color-alerta)]"
        >
          <TriangleAlert size={14} className="shrink-0" aria-hidden />
          «Desde» es posterior a «Hasta»: así {femenino ? "ninguna" : "ningún"} {uno} entra en el
          rango.
        </p>
      )}
    </div>
  );
}
