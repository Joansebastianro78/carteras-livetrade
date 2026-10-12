"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { diaCorto } from "@/lib/fechas";
import { leerResumenRevisados, type ResumenRevisados } from "@/lib/revisionHallazgos";
import type { ResumenAuditoria } from "@/lib/resumenAuditoria";
import { cifra } from "./ConsultaAthena";

/**
 * Tarjeta del Inicio con los hallazgos revisados: cuántos van, cuántos hoy,
 * una barra por día de las dos últimas semanas y quién ha revisado más.
 * Con el resumen de la última auditoría, también el avance de esa consulta.
 */

const ALTO_BARRA = 84;

export default function TarjetaRevisados({ auditoria }: { auditoria: ResumenAuditoria | null }) {
  const [resumen, setResumen] = useState<ResumenRevisados | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    leerResumenRevisados().then(({ resumen, aviso }) => {
      if (!vivo) return;
      setResumen(resumen);
      setAviso(aviso);
      setCargando(false);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const maximo = Math.max(1, ...(resumen?.dias.map((d) => d.n) ?? [0]));
  const pico = resumen?.dias.reduce((a, b) => (b.n > a.n ? b : a), resumen.dias[0]);

  // Avance de la última consulta de la auditoría vista en este navegador.
  const revisadosConsulta = auditoria?.revisados;
  const totalConsulta = auditoria && revisadosConsulta !== undefined ? auditoria.total + revisadosConsulta : 0;
  const avance = totalConsulta > 0 ? Math.round(((revisadosConsulta ?? 0) / totalConsulta) * 100) : null;

  return (
    <section aria-labelledby="resumen-revisados" className="tarjeta px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="resumen-revisados" className="text-[15px] font-semibold">
          Hallazgos revisados
        </h2>
        <a href="#revisados" className="inline-flex items-center gap-1 text-[13px] underline underline-offset-2">
          Ver revisados
          <ArrowRight size={13} aria-hidden />
        </a>
      </div>

      {cargando ? (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-[var(--color-tinta-suave)]">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          Cargando…
        </p>
      ) : !resumen ? (
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
          {aviso ?? "No se pudo leer el resumen de revisados."}
        </p>
      ) : resumen.total === 0 ? (
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
          Todavía no hay hallazgos revisados. Se marcan en Auditorías › Datos, uno por uno o con la carga masiva, y
          aquí sale cuántos van por día.
        </p>
      ) : (
        <>
          <p className="cifras mt-1.5 text-[22px] font-semibold">
            {cifra(resumen.total)} {resumen.total === 1 ? "revisado" : "revisados"}{" "}
            <span className="text-[14px] font-normal text-[var(--color-tinta-suave)]">
              · {cifra(resumen.hoy)} hoy · {cifra(resumen.semana)} en los últimos 7 días
            </span>
          </p>

          {avance !== null && (
            <div className="mt-3">
              <div className="flex flex-wrap justify-between gap-x-3 text-[13px]">
                <span>De la última consulta de la auditoría</span>
                <span className="cifras text-[var(--color-tinta-suave)]">
                  {avance} % · {cifra(revisadosConsulta ?? 0)} de {cifra(totalConsulta)}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Hallazgos revisados de la última consulta"
                aria-valuenow={avance}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-1.5 h-2 rounded bg-[var(--color-relleno)]"
              >
                <div
                  className="h-2 rounded bg-[var(--color-exito)]"
                  style={{ width: `${avance === 0 ? 0 : Math.max(2, avance)}%` }}
                />
              </div>
            </div>
          )}

          <figure className="mt-5">
            <figcaption className="text-[13px] text-[var(--color-tinta-suave)]">Por día, últimas dos semanas</figcaption>
            <div
              role="img"
              aria-label={
                resumen.dias.every((d) => d.n === 0)
                  ? "Sin revisiones en las últimas dos semanas."
                  : `Revisados por día en las últimas dos semanas. Hoy: ${cifra(resumen.hoy)}. El día con más: ${
                      pico ? `${diaCorto(pico.dia)}, ${cifra(pico.n)}` : ""
                    }.`
              }
              className="mt-2 flex items-end gap-1 sm:gap-1.5"
              style={{ height: ALTO_BARRA + 16 }}
            >
              {resumen.dias.map((d, i) => {
                const hoy = i === resumen.dias.length - 1;
                return (
                  <div
                    key={d.dia}
                    title={`${hoy ? "Hoy" : diaCorto(d.dia)}: ${cifra(d.n)} ${d.n === 1 ? "revisado" : "revisados"}`}
                    className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                  >
                    <span className="cifras text-[10px] leading-none text-[var(--color-tinta-suave)]">
                      {d.n > 0 ? (d.n >= 10_000 ? `${Math.round(d.n / 1000)}k` : cifra(d.n)) : ""}
                    </span>
                    <span
                      className={`block w-full rounded-t-[3px] ${
                        d.n === 0
                          ? "bg-[var(--color-relleno)]"
                          : hoy
                            ? "bg-[var(--color-exito)]"
                            : "bg-[var(--color-barra)]"
                      }`}
                      style={{ height: d.n === 0 ? 2 : Math.max(4, Math.round((d.n / maximo) * ALTO_BARRA)) }}
                    />
                  </div>
                );
              })}
            </div>
            <div aria-hidden className="mt-1 flex gap-1 border-t border-[var(--color-linea)] pt-1 sm:gap-1.5">
              {resumen.dias.map((d, i) => (
                <span
                  key={d.dia}
                  className={`cifras min-w-0 flex-1 text-center text-[10px] ${
                    i === resumen.dias.length - 1 ? "font-semibold text-[var(--color-tinta)]" : "text-[var(--color-tinta-suave)]"
                  }`}
                >
                  {Number(d.dia.slice(8))}
                </span>
              ))}
            </div>
          </figure>

          {resumen.personas.length > 0 && (
            <p className="mt-4 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
              Quién ha revisado más:{" "}
              {resumen.personas.slice(0, 3).map((p, i) => (
                <span key={p.usuario}>
                  {i > 0 && " · "}
                  <b className="font-semibold break-all text-[var(--color-tinta)]">{p.usuario}</b>{" "}
                  <span className="cifras">{cifra(p.n)}</span>
                </span>
              ))}
            </p>
          )}
        </>
      )}
    </section>
  );
}
