"use client";

import { Copy, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import type { FilaImagen } from "@/lib/imagenesAuditoria";
import { PARECIDO, type Grupo, type Parecido } from "@/lib/repetidas";
import { cifra } from "./ConsultaAthena";
import type { Repetidas, ResumenIA } from "./useRepetidas";

/**
 * Fotos repetidas, dentro de los filtros de la galería: buscar, cuánto va,
 * cuántos grupos salieron, ver solo esos, qué tan parecidas, y confirmar con IA.
 */
export default function PanelRepetidas<F extends FilaImagen>({
  r,
  soloRepetidas,
  onSoloRepetidas,
}: {
  r: Repetidas<F>;
  soloRepetidas: boolean;
  onSoloRepetidas: (valor: boolean) => void;
}) {
  const buscando = r.estado.tipo === "buscando";
  const visitas = r.grupos.reduce((n, g) => n + g.visitas.length, 0);

  let texto: string;
  if (r.estado.tipo === "buscando") {
    texto = `Revisando las fotos… ${cifra(r.estado.hechas)} de ${cifra(r.estado.total)}`;
  } else if (!r.buscado) {
    texto =
      r.total === 0
        ? "No hay fotos en estas fechas."
        : `Busca la misma foto usada en visitas distintas, entre las ${cifra(r.total)} ${r.total === 1 ? "foto" : "fotos"} de estas fechas.`;
  } else if (r.grupos.length === 0) {
    texto = "No hay fotos repetidas en estas fechas.";
  } else {
    texto = `${cifra(r.grupos.length)} ${r.grupos.length === 1 ? "grupo" : "grupos"} de fotos repetidas, con ${cifra(visitas)} visitas.`;
  }

  const barra = (hechos: number, total: number) => (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-relleno)]" aria-hidden>
      <span
        className="block h-full bg-[var(--color-tinta)] transition-[width]"
        style={{ width: `${total ? (hechos / total) * 100 : 0}%` }}
      />
    </span>
  );

  return (
    <section aria-label="Fotos repetidas" className="space-y-2.5 border-t border-[var(--color-linea)] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold">Fotos repetidas</h3>
          <p className="cifras text-[12.5px] leading-snug text-[var(--color-tinta-suave)]" role="status">
            {texto}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {buscando ? (
            <button type="button" onClick={r.detener} className="boton boton-secundario boton-chico">
              Detener
            </button>
          ) : (
            <>
              {r.buscado && r.grupos.length > 0 && (
                <button
                  type="button"
                  aria-pressed={soloRepetidas}
                  onClick={() => onSoloRepetidas(!soloRepetidas)}
                  className="chip"
                >
                  Ver solo repetidas
                  <span className="cifras opacity-75">{cifra(visitas)}</span>
                </button>
              )}
              {r.buscado && (
                <label className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-tinta-suave)]">
                  Parecido
                  <select
                    value={r.parecido}
                    onChange={(e) => r.setParecido(e.target.value as Parecido)}
                    aria-label="Qué tan parecidas tienen que ser"
                    className="rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)] px-2 py-1 text-[13px] text-[var(--color-tinta)]"
                  >
                    {(Object.keys(PARECIDO) as Parecido[]).map((p) => (
                      <option key={p} value={p}>
                        {PARECIDO[p].nombre}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(!r.buscado || r.sinRevisar > 0) && r.total > 0 && (
                <button type="button" onClick={r.buscar} className="boton boton-secundario boton-chico">
                  <Copy size={14} aria-hidden />
                  {r.buscado ? `Revisar las ${cifra(r.sinRevisar)} que faltan` : "Buscar repetidas"}
                </button>
              )}
              {r.pendientesIA.length > 0 &&
                (r.confirmando ? (
                  <button type="button" onClick={r.detenerIA} className="boton boton-secundario boton-chico">
                    Detener la IA
                  </button>
                ) : (
                  <button type="button" onClick={() => r.confirmar(r.pendientesIA)} className="boton boton-secundario boton-chico">
                    <Sparkles size={14} aria-hidden />
                    Confirmar con IA
                    <span className="cifras font-normal text-[var(--color-tinta-suave)]">
                      ({cifra(r.pendientesIA.length)} {r.pendientesIA.length === 1 ? "grupo" : "grupos"})
                    </span>
                  </button>
                ))}
            </>
          )}
        </div>
      </div>

      {r.estado.tipo === "buscando" && barra(r.estado.hechas, r.estado.total)}
      {r.confirmando && (
        <div className="space-y-1.5">
          <p className="cifras flex items-center gap-1.5 text-[12.5px] text-[var(--color-tinta-suave)]">
            <Loader2 size={13} className="animate-spin" aria-hidden />
            La IA está comparando las fotos… {cifra(r.confirmando.hechos)} de {cifra(r.confirmando.total)}
          </p>
          {barra(r.confirmando.hechos, r.confirmando.total)}
        </div>
      )}

      {r.buscado && !buscando && r.conError > 0 && (
        <p className="text-[12.5px] text-[var(--color-tinta-suave)]">
          {r.conError === 1 ? "Una foto no se pudo revisar" : `${cifra(r.conError)} fotos no se pudieron revisar`} (no
          cargaron o no son imágenes).
        </p>
      )}
      {[r.estado.tipo === "error" ? r.estado.mensaje : null, r.errorIA, r.aviso]
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

/** «IA: misma foto en 2 de 3», o nada si la IA no lo ha visto. */
export function textoIA(resumen: ResumenIA): string | null {
  if (resumen.revisadas === 0) return null;
  if (resumen.enlaces === resumen.total) return "Mismo enlace de foto";
  const base =
    resumen.mismas === 0
      ? "IA: son fotos distintas"
      : resumen.mismas === resumen.total
        ? resumen.total === 1
          ? "IA: es la misma foto"
          : "IA: es la misma foto en todas"
        : `IA: misma foto en ${resumen.mismas} de ${resumen.total}`;
  return resumen.revisadas < resumen.total ? `${base} (faltan ${resumen.total - resumen.revisadas})` : base;
}

/** Encabezado de un grupo de repetidas en la galería. */
export function EncabezadoGrupo<F extends FilaImagen>({
  grupo,
  resumen,
  enFiltro,
  confirmando,
  onConfirmar,
}: {
  grupo: Grupo<F>;
  resumen: ResumenIA;
  enFiltro: number;
  confirmando: boolean;
  onConfirmar: () => void;
}) {
  const ia = textoIA(resumen);
  const color =
    resumen.revisadas === 0
      ? ""
      : resumen.mismas > 0
        ? "bg-[var(--color-alerta-fondo)] text-[var(--color-alerta)]"
        : "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <h2 className="flex items-baseline gap-2 text-[15px] font-semibold">
        Grupo {cifra(grupo.numero)}
        <span className="cifras text-[13px] font-normal text-[var(--color-tinta-suave)]">
          {cifra(grupo.visitas.length)} visitas · {cifra(grupo.pdvs)} {grupo.pdvs === 1 ? "PDV" : "PDV distintos"} ·{" "}
          {cifra(grupo.consultores)} {grupo.consultores === 1 ? "consultor" : "consultores"}
          {enFiltro !== grupo.visitas.length && ` · ${cifra(enFiltro)} con estos filtros`}
        </span>
      </h2>
      {ia && <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${color}`}>{ia}</span>}
      {resumen.revisadas < resumen.total && (
        <button
          type="button"
          onClick={onConfirmar}
          disabled={confirmando}
          className="inline-flex items-center gap-1 text-[12.5px] font-medium underline underline-offset-2 disabled:opacity-50"
        >
          <Sparkles size={12} aria-hidden />
          Confirmar con IA
        </button>
      )}
    </div>
  );
}
