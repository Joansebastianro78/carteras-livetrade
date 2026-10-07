"use client";

import { useMemo, useState } from "react";
import { Loader2, Sheet, TriangleAlert } from "lucide-react";
import { exportarAuditoria } from "@/lib/excel";
import {
  SIN_RANGO,
  dentroDelRango,
  fechaLegible,
  hayRango,
  rangoAlReves,
  resumirFechas,
  sufijoRango,
  textoRango,
  type Rango,
} from "@/lib/fechas";
import { escribirExcel, limpiarAuditoria, limpiarTexto } from "@/lib/limpiadorAuditoria";
import { filasDesdeAthena, type FilaAuditoria } from "@/lib/auditoria";
import {
  EncabezadoConsulta,
  ProgresoConsulta,
  cifra,
  esperar,
  sinTildes,
  useConsultaAthena,
} from "./ConsultaAthena";
import RangoFechas from "./RangoFechas";

const POR_PAGINA = 50;

export default function Auditoria() {
  const { fase, filas, info, consultar, trabajando } = useConsultaAthena<FilaAuditoria>(
    "/api/admin/auditoria",
    filasDesdeAthena
  );
  const [aviso, setAviso] = useState<string | null>(null);
  /** Rango de fechas: delimita los hallazgos, los conteos y los dos Excel. */
  const [rango, setRango] = useState<Rango>(SIN_RANGO);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [visibles, setVisibles] = useState(POR_PAGINA);
  const [armando, setArmando] = useState(false);

  /** Nueva consulta: se limpian los filtros de la anterior. */
  function reconsultar(fresca: boolean) {
    setAviso(null);
    setRango(SIN_RANGO);
    setMotivo(null);
    setBusqueda("");
    setVisibles(POR_PAGINA);
    consultar(fresca);
  }

  // ------------------------------------------------------------ derivados
  /** Entre qué días hay hallazgos y cuántos no traen fecha. */
  const fechas = useMemo(
    () => resumirFechas(filas, (f) => f.dia, (f) => f.fecha),
    [filas]
  );

  const conRango = hayRango(rango);
  const alReves = rangoAlReves(rango);

  /**
   * Los hallazgos del rango de fechas, en el orden en que llegaron. Un
   * hallazgo sin fecha no entra en ningún rango.
   */
  const enRango = useMemo(
    () => (conRango ? filas.filter((f) => dentroDelRango(f.dia, rango)) : filas),
    [filas, conRango, rango]
  );

  const motivos = useMemo(() => {
    const conteo = new Map<string, number>();
    for (const f of enRango) conteo.set(f.motivo, (conteo.get(f.motivo) ?? 0) + 1);
    // El motivo elegido se queda a la vista aunque en esas fechas no tenga hallazgos.
    if (motivo && !conteo.has(motivo)) conteo.set(motivo, 0);
    return [...conteo.entries()]
      .map(([nombre, n]) => ({ nombre, n }))
      .sort((a, b) => b.n - a.n);
  }, [enRango, motivo]);

  const consultores = useMemo(
    () => new Set(enRango.map((f) => f.nombre_usuario).filter(Boolean)).size,
    [enRango]
  );

  const indice = useMemo(
    () =>
      filas.map((f) =>
        sinTildes(
          [
            f.codigo_bavaria,
            f.nombre_personalizado,
            f.nombre_usuario,
            f.departamento,
            f.provincia,
            limpiarTexto(f.componente_etiqueta),
            limpiarTexto(f.componente_valor),
            limpiarTexto(f.tipo_linea),
          ]
            .filter(Boolean)
            .join(" ")
        )
      ),
    [filas]
  );

  const filtradas = useMemo(() => {
    const q = sinTildes(busqueda.trim());
    return filas.filter(
      (f, i) =>
        dentroDelRango(f.dia, rango) &&
        (!motivo || f.motivo === motivo) &&
        (!q || indice[i].includes(q))
    );
  }, [filas, indice, rango, motivo, busqueda]);

  /**
   * Excel limpio: los hallazgos del rango de fechas (sin rango, todos) pasan
   * por el limpiador de auditoría (tildes, preguntas unificadas, tipo de línea)
   * y salen sus ocho hojas. fila_excel apunta a la fila del Excel sin limpiar
   * descargado con las mismas fechas, que trae las filas en este mismo orden.
   */
  async function descargarLimpio() {
    setArmando(true);
    setAviso(null);
    // Un respiro para que se pinte el "Armando…" antes del trabajo pesado.
    await esperar(30);
    try {
      // El rango queda escrito en la hoja «Notas», como origen de los datos.
      const origen = conRango ? `Consulta de auditoría (${textoRango(rango)})` : "Consulta de auditoría";
      const r = limpiarAuditoria(enRango, origen);
      if (!r) {
        setAviso("La auditoría no trae filas con datos para limpiar.");
        return;
      }
      const datos = await escribirExcel(r.hojas);
      const url = URL.createObjectURL(
        new Blob([datos], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        })
      );
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = `auditoria_bavaria_puntos_limpia_${sufijoRango(rango)}.xlsx`;
      enlace.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      console.error("[auditoria excel limpio]", e);
      setAviso("No se pudo armar el Excel limpio. Intenta de nuevo.");
    } finally {
      setArmando(false);
    }
  }

  function descargarSinLimpiar() {
    try {
      exportarAuditoria(enRango, sufijoRango(rango));
    } catch {
      setAviso("No se pudo armar el Excel. Intenta de nuevo.");
    }
  }

  // ------------------------------------------------------------ pantalla
  return (
    <div className="space-y-4">
      <EncabezadoConsulta
        titulo="Auditoría de datos"
        info={info}
        trabajando={trabajando}
        onConsultar={() => reconsultar(true)}
      />

      <ProgresoConsulta fase={fase} onReintentar={() => reconsultar(false)} />

      {aviso && (
        <p className="flex items-center gap-2 rounded-[4px] bg-[#fdf4e3] px-3 py-2.5 text-[13px] text-[#7a5410]">
          <TriangleAlert size={14} className="shrink-0" aria-hidden />
          {aviso}
        </p>
      )}

      {/* ----------------------------------------------------- resultado */}
      {fase.tipo === "listo" && filas.length === 0 && (
        <p className="rounded-[4px] border border-dashed border-[var(--color-linea)] px-4 py-6 text-center text-[13px] text-[var(--color-tinta-suave)]">
          La auditoría no encontró datos con problemas.
        </p>
      )}

      {fase.tipo === "listo" && filas.length > 0 && (
        <>
          <section className="rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)] p-5">
            <p className="cifras text-[15px] font-semibold text-[var(--color-tinta)]">
              {cifra(enRango.length)} {enRango.length === 1 ? "hallazgo" : "hallazgos"}
              <span className="font-normal text-[var(--color-tinta-suave)]">
                {" "}
                · {cifra(consultores)} {consultores === 1 ? "consultor" : "consultores"}
                {conRango && !alReves && ` · ${textoRango(rango)}`}
              </span>
            </p>

            <RangoFechas
              id="auditoria"
              rango={rango}
              onCambiar={(nuevo) => {
                setRango(nuevo);
                setVisibles(POR_PAGINA);
              }}
              fechas={fechas}
              uno="hallazgo"
              varios="hallazgos"
            />

            <div className="mt-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  onClick={descargarLimpio}
                  disabled={armando || enRango.length === 0}
                  aria-busy={armando}
                  className="flex items-center gap-2 rounded-[4px] bg-[var(--color-ambar)] px-3 py-2 text-[13px] font-medium text-white hover:bg-[var(--color-ambar-oscuro)] disabled:opacity-60"
                >
                  {armando ? (
                    <Loader2 size={15} className="animate-spin" aria-hidden />
                  ) : (
                    <Sheet size={15} aria-hidden />
                  )}
                  {armando ? "Armando el Excel…" : "Descargar Excel limpio"}
                </button>
                <button
                  type="button"
                  onClick={descargarSinLimpiar}
                  disabled={armando || enRango.length === 0}
                  className="text-[13px] text-[var(--color-tinta-suave)] underline underline-offset-2 hover:text-[var(--color-tinta)] disabled:opacity-45"
                >
                  Datos sin limpiar
                </button>
              </div>
              {enRango.length === 0 ? (
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-tinta-suave)]">
                  No hay hallazgos en esas fechas para descargar.
                </p>
              ) : (
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-tinta-suave)]">
                  El Excel limpio pasa{" "}
                  {conRango
                    ? `${enRango.length === 1 ? "el hallazgo" : `los ${cifra(enRango.length)} hallazgos`} de esas fechas, de ${cifra(filas.length)} en total,`
                    : `los ${cifra(filas.length)} hallazgos`}{" "}
                  por el limpiador de auditoría: tildes arregladas, preguntas unificadas, cada
                  respuesta con su tipo de línea y ocho hojas (resumen por usuario, usuario por
                  pregunta, usuario por código, resumen por pregunta, resumen por tipo de línea,
                  preguntas en horizontal, detalle y notas).
                  {conRango && " «Datos sin limpiar» trae esos mismos hallazgos."}
                </p>
              )}
            </div>

            <div className="mt-4 border-t border-[var(--color-linea)] pt-3">
              <p className="text-xs text-[var(--color-tinta-suave)]">
                Toca un motivo para ver solo esos hallazgos.
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {motivos.map((m) => {
                  const activo = motivo === m.nombre;
                  return (
                    <li key={m.nombre}>
                      <button
                        type="button"
                        aria-pressed={activo}
                        onClick={() => {
                          setMotivo(activo ? null : m.nombre);
                          setVisibles(POR_PAGINA);
                        }}
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                          activo
                            ? "border-[var(--color-tinta)] bg-[var(--color-tinta)] text-white"
                            : "border-[var(--color-linea)] text-[var(--color-tinta)] hover:border-[var(--color-tinta)]"
                        }`}
                      >
                        {m.nombre}
                        <span
                          className={`cifras ${activo ? "text-white/75" : "text-[var(--color-tinta-suave)]"}`}
                        >
                          {cifra(m.n)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          <div className="overflow-hidden rounded-[4px] border border-[var(--color-linea)]">
            <div className="border-b border-[var(--color-linea)] bg-[var(--color-papel)] p-3">
              <label htmlFor="auditoria-buscar" className="sr-only">
                Buscar en la auditoría
              </label>
              <input
                id="auditoria-buscar"
                value={busqueda}
                onChange={(e) => {
                  setBusqueda(e.target.value);
                  setVisibles(POR_PAGINA);
                }}
                placeholder="Buscar por código, PDV, consultor, departamento o respuesta"
                className="campo"
              />
              {(busqueda.trim() || motivo) && (
                <p className="cifras mt-1.5 text-xs text-[var(--color-tinta-suave)]">
                  {cifra(filtradas.length)} de {cifra(enRango.length)} hallazgos
                  {conRango
                    ? " de esas fechas. El Excel trae todos los de esas fechas."
                    : ". El Excel siempre trae todos."}
                </p>
              )}
            </div>

            <ul className="max-h-[70vh] divide-y divide-[var(--color-linea)] overflow-y-auto bg-[var(--color-papel)]">
              {filtradas.slice(0, visibles).map((f, i) => (
                <li key={i} className="px-4 py-3">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-[var(--color-tinta)]">
                    {limpiarTexto(f.nombre_personalizado) ?? "PDV sin nombre"}
                    {f.codigo_bavaria && (
                      <span className="cifras text-xs font-normal text-[var(--color-tinta-suave)]">
                        {f.codigo_bavaria}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-[var(--color-tinta-suave)]">
                    {limpiarTexto(f.componente_etiqueta) ?? "Sin pregunta"}
                  </p>
                  <p className="mt-1 text-[13px] text-[var(--color-tinta)]">
                    {limpiarTexto(f.componente_valor) ? (
                      <>
                        Respuesta:{" "}
                        <span className="font-medium break-words">
                          {limpiarTexto(f.componente_valor)}
                        </span>
                      </>
                    ) : (
                      <span className="text-[var(--color-alerta)]">Sin respuesta</span>
                    )}
                  </p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-tinta-suave)]">
                    <span className="rounded-full bg-[#f8ecea] px-2 py-0.5 text-[var(--color-alerta)]">
                      {f.motivo}
                    </span>
                    {limpiarTexto(f.tipo_linea) && (
                      <span className="rounded-full bg-[#eceeeb] px-2 py-0.5 text-[var(--color-tinta)]">
                        {limpiarTexto(f.tipo_linea)}
                      </span>
                    )}
                    {f.nombre_usuario && (
                      <span className="text-[var(--color-tinta)]">{limpiarTexto(f.nombre_usuario)}</span>
                    )}
                    {(f.departamento || f.provincia) && (
                      <span>
                        {[limpiarTexto(f.provincia), limpiarTexto(f.departamento)]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    )}
                    {fechaLegible(f.fecha) && (
                      <span className="cifras">{fechaLegible(f.fecha)}</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>

            {filtradas.length === 0 && (
              <p className="bg-[var(--color-papel)] px-4 py-6 text-center text-[13px] text-[var(--color-tinta-suave)]">
                {enRango.length === 0
                  ? "No hay hallazgos en esas fechas."
                  : "Ningún hallazgo coincide con esa búsqueda."}
              </p>
            )}

            {filtradas.length > visibles && (
              <div className="border-t border-[var(--color-linea)] bg-[var(--color-papel)] p-3 text-center">
                <button
                  type="button"
                  onClick={() => setVisibles((v) => v + POR_PAGINA)}
                  className="rounded-[4px] border border-[var(--color-linea)] px-3 py-1.5 text-[13px] text-[var(--color-tinta)] hover:border-[var(--color-tinta)]"
                >
                  Mostrar {cifra(Math.min(POR_PAGINA, filtradas.length - visibles))} más
                  <span className="cifras text-[var(--color-tinta-suave)]">
                    {" "}
                    ({cifra(visibles)} de {cifra(filtradas.length)})
                  </span>
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
