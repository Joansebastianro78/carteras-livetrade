"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  RotateCcw,
  TriangleAlert,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import type { FilaAuditoria } from "@/lib/auditoria";
import {
  MAXIMO_FILAS,
  NOMBRE_PLANTILLA,
  copiaDeCarga,
  cruzarRevisados,
  descargarPlantillaRevisados,
  exportarNoUsadas,
  leerArchivoRevisados,
  type CruceRevisados,
  type PdvAMarcar,
} from "@/lib/cargaRevisados";
import { cifra, esperar } from "./ConsultaAthena";

/**
 * Carga masiva de hallazgos revisados: se sube la plantilla, se ve qué se va
 * a marcar y, al confirmar, se marca por lotes. Al terminar se puede deshacer
 * toda la carga. Va dentro de la auditoría de datos porque cruza el archivo
 * con los hallazgos de la consulta que está abierta.
 */

const RUTA = "/api/admin/revision-hallazgos";
/** Lo que acepta la ruta en un POST. */
const LOTE = 500;
/** Al devolver, la lista de claves va en la dirección: lotes más cortos. */
const LOTE_DEVOLVER = 200;
const PESO_MAXIMO = 15 * 1024 * 1024;
const VISIBLES = 8;

type Estado =
  | { fase: "archivo"; error: string | null }
  | { fase: "leyendo"; archivo: string }
  | { fase: "revisar"; archivo: string; hoja: string; cruce: CruceRevisados; error: string | null }
  | { fase: "guardando"; archivo: string; cruce: CruceRevisados; hechos: number }
  | {
      fase: "listo";
      archivo: string;
      cruce: CruceRevisados;
      /** Hasta dónde se marcó de cruce.marcar (todo, si no hubo error). */
      marcados: number;
      /** Los hallazgos de la auditoría que eso cubre (filas). */
      hallazgos: number;
      /** Las claves que marcó esta carga (sin las que alguien marcó antes). */
      nuevos: string[];
      quien: string | null;
      momento: string | null;
      fallo: string | null;
      deshaciendo: boolean;
      errorDeshacer: string | null;
    }
  | { fase: "deshecho"; archivo: string; devueltos: number };

const FOCO = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function CargaMasivaRevisados({
  filas,
  revisados,
  claveDe,
  pendientes,
  onMarcados,
  onDevueltos,
  onCerrar,
}: {
  /** Toda la consulta abierta, también lo ya revisado. */
  filas: FilaAuditoria[];
  revisados: ReadonlySet<string>;
  claveDe: (f: FilaAuditoria) => string;
  /** Cuántos hallazgos faltan por revisar ahora mismo. */
  pendientes: number;
  onMarcados: (claves: string[]) => void;
  onDevueltos: (claves: string[]) => void;
  onCerrar: () => void;
}) {
  const [estado, setEstado] = useState<Estado>({ fase: "archivo", error: null });
  const [arrastrando, setArrastrando] = useState(false);
  const [armandoPlantilla, setArmandoPlantilla] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  const [verNoUsadas, setVerNoUsadas] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const cerrar = useRef<HTMLButtonElement>(null);
  const elegir = useRef<HTMLInputElement>(null);
  /** La hoja que se leyó, para volver a la revisión si el guardado falla. */
  const hoja = useRef("");

  const ocupado =
    estado.fase === "leyendo" || estado.fase === "guardando" || (estado.fase === "listo" && estado.deshaciendo);

  // Mientras está abierta: la página de atrás no se mueve, el foco entra
  // aquí y, al cerrar, vuelve al botón que la abrió.
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cerrar.current?.focus();
    return () => {
      document.body.style.overflow = scroll;
      antes?.focus?.();
    };
  }, []);

  // Escape cierra (salvo mientras guarda) y Tab no se sale de la ventana.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (!ocupado) onCerrar();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const focos = [...panel.current.querySelectorAll<HTMLElement>(FOCO)].filter((el) => el.offsetParent !== null);
      if (focos.length === 0) return;
      const [primero, ultimo] = [focos[0], focos[focos.length - 1]];
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener("keydown", tecla, true);
    return () => document.removeEventListener("keydown", tecla, true);
  }, [ocupado, onCerrar]);

  // ------------------------------------------------------------ acciones
  async function bajarPlantilla() {
    setArmandoPlantilla(true);
    try {
      await descargarPlantillaRevisados();
    } catch (e) {
      console.error("[carga masiva plantilla]", e);
      setEstado({ fase: "archivo", error: "No se pudo armar la plantilla. Intenta de nuevo." });
    } finally {
      setArmandoPlantilla(false);
    }
  }

  async function leer(archivo: File) {
    if (archivo.size > PESO_MAXIMO) {
      setEstado({ fase: "archivo", error: "El archivo pesa más de 15 MB. Deja solo la hoja con las filas y vuelve a intentar." });
      return;
    }
    setEstado({ fase: "leyendo", archivo: archivo.name });
    setVerTodos(false);
    setVerNoUsadas(false);
    await esperar(30); // que alcance a pintarse el «Leyendo…»
    try {
      const lectura = leerArchivoRevisados(await archivo.arrayBuffer());
      const cruce = cruzarRevisados(lectura, filas, revisados, claveDe);
      hoja.current = lectura.hoja;
      setEstado({ fase: "revisar", archivo: archivo.name, hoja: lectura.hoja, cruce, error: null });
    } catch (e) {
      setEstado({ fase: "archivo", error: (e as Error).message || "No se pudo leer el archivo." });
    }
  }

  /** Marca por lotes desde `desde`. Si un lote falla, se queda con lo que alcanzó. */
  async function guardar(archivo: string, cruce: CruceRevisados, desde = 0, previos: string[] = []) {
    const lista = cruce.marcar;
    const nuevos = [...previos];
    let quien: string | null = null;
    let momento: string | null = null;
    let i = desde;
    setEstado({ fase: "guardando", archivo, cruce, hechos: desde });
    try {
      for (; i < lista.length; i += LOTE) {
        const lote = lista.slice(i, i + LOTE);
        const ultimo = i + LOTE >= lista.length;
        const r = await fetch(RUTA, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hallazgos: lote.map((m) => copiaDeCarga(m, archivo)),
            // Una sola línea en la actividad del panel, con el último lote.
            ...(ultimo ? { carga: { archivo, hallazgos: cruce.hallazgos, pdv: cruce.pdv.length } } : {}),
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? "No se pudieron marcar como revisados.");
        nuevos.push(...((j.nuevos as string[] | undefined) ?? []));
        quien = j.revisado_por ?? quien;
        momento = j.revisado_en ?? momento;
        // Revisados por esta carga o por alguien más: igual salen de la lista.
        onMarcados(lote.map((m) => m.clave));
        setEstado({ fase: "guardando", archivo, cruce, hechos: Math.min(i + LOTE, lista.length) });
      }
      setEstado({
        fase: "listo",
        archivo,
        cruce,
        marcados: lista.length,
        hallazgos: cruce.hallazgos,
        nuevos,
        quien,
        momento,
        fallo: null,
        deshaciendo: false,
        errorDeshacer: null,
      });
    } catch (e) {
      const mensaje = (e as Error).message || "No se pudieron marcar como revisados.";
      if (i === 0) {
        // No se alcanzó a marcar nada: se vuelve a la revisión con el error.
        setEstado({ fase: "revisar", archivo, hoja: hoja.current, cruce, error: mensaje });
        return;
      }
      setEstado({
        fase: "listo",
        archivo,
        cruce,
        marcados: i,
        hallazgos: lista.slice(0, i).reduce((t, m) => t + m.filas, 0),
        nuevos,
        quien,
        momento,
        fallo: mensaje,
        deshaciendo: false,
        errorDeshacer: null,
      });
    }
  }

  async function deshacerCarga() {
    if (estado.fase !== "listo") return;
    const { nuevos } = estado;
    setEstado({ ...estado, deshaciendo: true, errorDeshacer: null });
    const devueltos: string[] = [];
    try {
      for (let i = 0; i < nuevos.length; i += LOTE_DEVOLVER) {
        const lote = nuevos.slice(i, i + LOTE_DEVOLVER);
        const ultimo = i + LOTE_DEVOLVER >= nuevos.length;
        const r = await fetch(RUTA, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claves: lote,
            ...(ultimo ? { carga: { archivo: estado.archivo, hallazgos: nuevos.length } } : {}),
          }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? "No se pudo deshacer.");
        }
        devueltos.push(...lote);
        onDevueltos(lote);
      }
      setEstado({ fase: "deshecho", archivo: estado.archivo, devueltos: devueltos.length });
    } catch (e) {
      const pendientes = nuevos.filter((c) => !devueltos.includes(c));
      setEstado({
        ...estado,
        nuevos: pendientes,
        deshaciendo: false,
        errorDeshacer: `${(e as Error).message} ${
          devueltos.length > 0 ? `Se devolvieron ${cifra(devueltos.length)}; ` : ""
        }lo demás se puede devolver desde Revisados o intentando otra vez.`,
      });
    }
  }

  function otroArchivo() {
    setEstado({ fase: "archivo", error: null });
  }

  // ------------------------------------------------------------ pantalla
  const paso = estado.fase === "archivo" || estado.fase === "leyendo" ? 0 : estado.fase === "revisar" || estado.fase === "guardando" ? 1 : 2;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-[var(--color-velo)] sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !ocupado) onCerrar();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="carga-masiva-titulo"
        className="flex max-h-[100dvh] w-full max-w-[780px] flex-col overflow-hidden rounded-t-[10px] bg-[var(--color-papel)] shadow-[0_16px_48px_var(--color-sombra)] sm:max-h-[min(900px,94dvh)] sm:rounded-[8px]"
      >
        {/* ------------------------------------------------ encabezado */}
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-linea)] px-5 pt-4 pb-3.5">
          <div className="min-w-0">
            <h2 id="carga-masiva-titulo" className="text-[17px] font-semibold">
              Carga masiva de revisados
            </h2>
            <ol aria-label="Pasos" className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
              {["Archivo", "Revisar", "Listo"].map((nombre, i) => (
                <li key={nombre} className="flex items-center gap-2" aria-current={i === paso ? "step" : undefined}>
                  <span
                    className={`flex items-center gap-1.5 ${
                      i === paso ? "font-semibold text-[var(--color-tinta)]" : "text-[var(--color-tinta-suave)]"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${
                        i < paso
                          ? "bg-[var(--color-exito)] text-[var(--color-sobre-exito)]"
                          : i === paso
                            ? "bg-[var(--color-tinta)] text-[var(--color-sobre-tinta)]"
                            : "bg-[var(--color-relleno)]"
                      }`}
                    >
                      {i < paso ? "✓" : i + 1}
                    </span>
                    {nombre}
                  </span>
                  {i < 2 && <span className="h-px w-5 bg-[var(--color-linea)]" aria-hidden />}
                </li>
              ))}
            </ol>
          </div>
          <button
            ref={cerrar}
            type="button"
            onClick={onCerrar}
            disabled={ocupado}
            aria-label="Cerrar"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-[var(--color-hover)] disabled:opacity-40"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* ------------------------------------------------ cuerpo */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {(estado.fase === "archivo" || estado.fase === "leyendo") && (
            <div className="space-y-5">
              <p className="text-[14px] leading-relaxed text-[var(--color-tinta-suave)]">
                Marca como revisados muchos hallazgos de una vez con un Excel. El archivo se cruza con los{" "}
                <b className="font-semibold text-[var(--color-tinta)]">
                  {cifra(pendientes)} {pendientes === 1 ? "hallazgo pendiente" : "hallazgos pendientes"}
                </b>{" "}
                de la consulta que tienes abierta; los filtros de la pantalla no cuentan. Antes de marcar nada te muestro
                qué se va a marcar.
              </p>

              {estado.fase === "archivo" && estado.error && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-[4px] bg-[var(--color-alerta-fondo)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-alerta)]"
                >
                  <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
                  {estado.error}
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-[1fr_1.35fr]">
                <div className="rounded-[6px] border border-[var(--color-linea)] px-4 py-4">
                  <p className="text-[13px] font-semibold text-[var(--color-tinta-suave)]">1 · Plantilla</p>
                  <p className="mt-2 flex items-center gap-2 text-[14px] font-medium break-all">
                    <FileSpreadsheet size={18} className="shrink-0 text-[var(--color-exito)]" aria-hidden />
                    {NOMBRE_PLANTILLA}
                  </p>
                  <p className="mt-1.5 text-[13px] leading-snug text-[var(--color-tinta-suave)]">
                    Una fila por PDV, o por PDV y motivo. Solo el código es obligatorio.
                  </p>
                  <button
                    type="button"
                    onClick={bajarPlantilla}
                    disabled={armandoPlantilla}
                    className="boton boton-secundario boton-chico mt-4"
                  >
                    {armandoPlantilla ? (
                      <Loader2 size={15} className="animate-spin" aria-hidden />
                    ) : (
                      <Download size={15} aria-hidden />
                    )}
                    {armandoPlantilla ? "Armando…" : "Descargar plantilla"}
                  </button>
                </div>

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setArrastrando(true);
                  }}
                  onDragLeave={() => setArrastrando(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setArrastrando(false);
                    const archivo = e.dataTransfer.files?.[0];
                    if (archivo && estado.fase !== "leyendo") leer(archivo);
                  }}
                  className={`rounded-[6px] border-2 border-dashed px-5 py-5 text-center ${
                    arrastrando
                      ? "border-[var(--color-tinta)] bg-[var(--color-seleccion)]"
                      : "border-[var(--color-linea)]"
                  }`}
                >
                  <p className="text-[13px] font-semibold text-[var(--color-tinta-suave)]">2 · Archivo</p>
                  <FileSpreadsheet size={28} className="mx-auto mt-2.5 text-[var(--color-tinta-suave)]" aria-hidden />
                  <p className="mt-2 text-[15px] font-medium">Arrastra el archivo aquí</p>
                  <p className="mt-1 text-[13px] text-[var(--color-tinta-suave)]">
                    La plantilla llena, hasta {cifra(MAXIMO_FILAS)} filas
                  </p>
                  <input
                    ref={elegir}
                    type="file"
                    accept=".xlsx,.xls,.xlsm,.csv"
                    className="sr-only"
                    aria-label="Elegir el archivo"
                    tabIndex={-1}
                    onChange={(e) => {
                      const archivo = e.target.files?.[0];
                      if (archivo) leer(archivo);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => elegir.current?.click()}
                    disabled={estado.fase === "leyendo"}
                    className="boton boton-primario mt-4 max-w-full"
                  >
                    {estado.fase === "leyendo" ? (
                      <Loader2 size={16} className="animate-spin" aria-hidden />
                    ) : (
                      <Upload size={16} aria-hidden />
                    )}
                    <span className="truncate">
                      {estado.fase === "leyendo" ? `Leyendo ${estado.archivo}…` : "Elegir archivo"}
                    </span>
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-2 text-[13px] font-semibold">Qué lleva cada columna</p>
                <ul className="divide-y divide-[var(--color-linea)] rounded-[6px] border border-[var(--color-linea)] text-[13px]">
                  {[
                    ["CODIGO BAVARIA", true, "El código del PDV, con sus ceros a la izquierda."],
                    ["MOTIVO", false, "Uno de la lista. Vacío: todos los hallazgos pendientes del PDV."],
                    ["FECHA", false, "Día del hallazgo. Vacía: de cualquier día."],
                    ["OBSERVACION", false, "Lo que se hizo. Queda guardada en Revisados."],
                  ].map(([columna, obligatoria, que]) => (
                    <li
                      key={columna as string}
                      className="px-3 py-2 sm:grid sm:grid-cols-[150px_96px_1fr] sm:items-center sm:gap-x-3"
                    >
                      <span className="flex items-center gap-2 sm:contents">
                        <b className="font-semibold">{columna}</b>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] sm:justify-self-start ${
                            obligatoria
                              ? "bg-[var(--color-info-fondo)] font-semibold text-[var(--color-info-tinta)]"
                              : "bg-[var(--color-relleno)] text-[var(--color-tinta-suave)]"
                          }`}
                        >
                          {obligatoria ? "Obligatoria" : "Opcional"}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[var(--color-tinta-suave)] sm:mt-0">{que}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {(estado.fase === "revisar" || estado.fase === "guardando") && (
            <Revision
              estado={estado}
              verTodos={verTodos}
              verNoUsadas={verNoUsadas}
              onVerTodos={() => setVerTodos(true)}
              onVerNoUsadas={() => setVerNoUsadas(true)}
              onOtroArchivo={otroArchivo}
            />
          )}

          {estado.fase === "listo" && (
            <div className="space-y-5">
              <div>
                <h3
                  className={`flex items-center gap-2 text-[17px] font-semibold ${
                    estado.fallo ? "text-[var(--color-aviso-tinta)]" : "text-[var(--color-exito)]"
                  }`}
                >
                  {estado.fallo ? <TriangleAlert size={20} aria-hidden /> : <CheckCircle2 size={20} aria-hidden />}
                  {estado.fallo
                    ? `Se marcaron ${cifra(estado.hallazgos)} de ${cifra(estado.cruce.hallazgos)} hallazgos`
                    : `${cifra(estado.hallazgos)} ${estado.hallazgos === 1 ? "hallazgo marcado" : "hallazgos marcados"} como revisados`}
                </h3>
                <p className="mt-1 text-[13px] break-words text-[var(--color-tinta-suave)]">
                  {[estado.archivo, estado.quien && `a nombre de ${estado.quien}`, estado.momento && horaDe(estado.momento)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>

              {estado.fallo && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-[4px] bg-[var(--color-aviso-fondo)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-aviso-tinta)]"
                >
                  <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
                  <span>
                    {estado.fallo} Faltan {cifra(estado.cruce.hallazgos - estado.hallazgos)}: puedes intentar otra vez
                    con «Marcar lo que falta».
                  </span>
                </p>
              )}

              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-4">
                {[
                  ["Marcados", estado.hallazgos],
                  ["PDV", estado.cruce.pdv.length],
                  ["Siguen pendientes", pendientes],
                  ["Filas sin usar", estado.cruce.noUsadas.length],
                ].map(([t, n]) => (
                  <div key={t as string}>
                    <dt className="text-[var(--color-tinta-suave)]">{t}</dt>
                    <dd className="cifras text-xl font-semibold">{cifra(n as number)}</dd>
                  </div>
                ))}
              </dl>

              {estado.marcados - estado.nuevos.length > 0 && !estado.errorDeshacer && (
                <p className="flex items-start gap-2 text-[12px] leading-snug text-[var(--color-tinta-suave)]">
                  <Info size={14} className="mt-px shrink-0" aria-hidden />
                  {estado.marcados - estado.nuevos.length === 1
                    ? "Uno ya lo había marcado alguien más mientras tanto: queda a su nombre."
                    : `${cifra(estado.marcados - estado.nuevos.length)} ya los había marcado alguien más mientras tanto: quedan a su nombre.`}
                </p>
              )}

              {estado.errorDeshacer ? (
                <p
                  role="alert"
                  className="rounded-[4px] bg-[var(--color-alerta-fondo)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-alerta)]"
                >
                  {estado.errorDeshacer}
                </p>
              ) : (
                <p className="rounded-[4px] bg-[var(--color-exito-fondo)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-exito)]">
                  Ya salieron de la auditoría y están en Auditorías › Revisados con la observación de cada fila. Si fue
                  un error, «Deshacer esta carga» los devuelve todos a pendientes.
                </p>
              )}

              {estado.cruce.noUsadas.length > 0 && (
                <p className="text-[13px]">
                  <button
                    type="button"
                    onClick={() => exportarNoUsadas(estado.cruce.noUsadas, estado.archivo)}
                    className="underline underline-offset-2"
                  >
                    {estado.cruce.noUsadas.length === 1
                      ? "Descargar la fila con observaciones"
                      : `Descargar las ${cifra(estado.cruce.noUsadas.length)} filas con observaciones`}
                  </button>
                </p>
              )}
            </div>
          )}

          {estado.fase === "deshecho" && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 text-[17px] font-semibold">
                <Undo2 size={20} aria-hidden />
                Carga deshecha
              </h3>
              <p className="text-[14px] leading-relaxed text-[var(--color-tinta-suave)]">
                {estado.devueltos === 1
                  ? "El hallazgo que marcó"
                  : `Los ${cifra(estado.devueltos)} hallazgos que marcó`}{" "}
                {estado.archivo} {estado.devueltos === 1 ? "volvió" : "volvieron"} a pendientes y otra vez{" "}
                {estado.devueltos === 1 ? "sale" : "salen"} en la auditoría.
              </p>
            </div>
          )}
        </div>

        {/* ------------------------------------------------ botones */}
        <div className="flex flex-col-reverse gap-2.5 border-t border-[var(--color-linea)] px-5 py-3.5 pb-[max(14px,env(safe-area-inset-bottom))] sm:flex-row sm:flex-wrap sm:justify-end [&>.boton]:w-full sm:[&>.boton]:w-auto">
          {(estado.fase === "archivo" || estado.fase === "leyendo") && (
            <button type="button" onClick={onCerrar} disabled={ocupado} className="boton boton-secundario">
              Cancelar
            </button>
          )}

          {(estado.fase === "revisar" || estado.fase === "guardando") && (
            <>
              <button type="button" onClick={onCerrar} disabled={ocupado} className="boton boton-secundario">
                Cancelar
              </button>
              {estado.cruce.marcar.length > 0 ? (
                <button
                  type="button"
                  onClick={() => guardar(estado.archivo, estado.cruce)}
                  disabled={ocupado}
                  className="boton boton-primario"
                >
                  {estado.fase === "guardando" ? (
                    <Loader2 size={16} className="animate-spin" aria-hidden />
                  ) : (
                    <CheckCircle2 size={16} aria-hidden />
                  )}
                  {estado.fase === "guardando"
                    ? "Marcando…"
                    : estado.cruce.hallazgos === 1
                      ? "Marcar 1 hallazgo como revisado"
                      : `Marcar ${cifra(estado.cruce.hallazgos)} hallazgos como revisados`}
                </button>
              ) : (
                <button type="button" onClick={otroArchivo} className="boton boton-primario">
                  <Upload size={16} aria-hidden />
                  Elegir otro archivo
                </button>
              )}
            </>
          )}

          {estado.fase === "listo" && (
            <>
              {estado.nuevos.length > 0 && (
                <button
                  type="button"
                  onClick={deshacerCarga}
                  disabled={ocupado}
                  className="boton boton-secundario sm:mr-auto"
                >
                  {estado.deshaciendo ? (
                    <Loader2 size={16} className="animate-spin" aria-hidden />
                  ) : (
                    <Undo2 size={16} aria-hidden />
                  )}
                  {estado.deshaciendo ? "Deshaciendo…" : estado.fallo ? "Deshacer lo marcado" : "Deshacer esta carga"}
                </button>
              )}
              {estado.fallo ? (
                <button
                  type="button"
                  onClick={() => guardar(estado.archivo, estado.cruce, estado.marcados, estado.nuevos)}
                  disabled={ocupado}
                  className="boton boton-primario"
                >
                  <RotateCcw size={16} aria-hidden />
                  Marcar lo que falta
                </button>
              ) : (
                <>
                  <button type="button" onClick={otroArchivo} disabled={ocupado} className="boton boton-secundario">
                    <Upload size={16} aria-hidden />
                    Cargar otro archivo
                  </button>
                  <a
                    href="#revisados"
                    onClick={onCerrar}
                    aria-disabled={ocupado}
                    className={`boton boton-primario ${ocupado ? "pointer-events-none opacity-45" : ""}`}
                  >
                    Ver revisados
                    <ArrowRight size={16} aria-hidden />
                  </a>
                </>
              )}
            </>
          )}

          {estado.fase === "deshecho" && (
            <>
              <button type="button" onClick={onCerrar} className="boton boton-secundario">
                Cerrar
              </button>
              <button type="button" onClick={otroArchivo} className="boton boton-primario">
                <Upload size={16} aria-hidden />
                Cargar otro archivo
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** "hoy, 3:42 p. m." en hora de Colombia. */
function horaDe(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  return `hoy, ${new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" }).format(fecha)}`;
}

/** "0012067 · BAV029 · BAV012 y 3 más". */
function codigoYConsultores(p: PdvAMarcar): string {
  const resto = p.consultores.length - 2;
  return [p.codigo, ...p.consultores.slice(0, 2)].join(" · ") + (resto > 0 ? ` y ${cifra(resto)} más` : "");
}

/** El paso 2: qué se va a marcar y qué filas no se usan. */
function Revision({
  estado,
  verTodos,
  verNoUsadas,
  onVerTodos,
  onVerNoUsadas,
  onOtroArchivo,
}: {
  estado: Extract<Estado, { fase: "revisar" | "guardando" }>;
  verTodos: boolean;
  verNoUsadas: boolean;
  onVerTodos: () => void;
  onVerNoUsadas: () => void;
  onOtroArchivo: () => void;
}) {
  const { cruce, archivo } = estado;
  const guardando = estado.fase === "guardando";
  const pdv = verTodos ? cruce.pdv.slice(0, 500) : cruce.pdv.slice(0, VISIBLES);
  const noUsadas = verNoUsadas ? cruce.noUsadas.slice(0, 300) : cruce.noUsadas.slice(0, 6);
  const porcentaje = guardando && cruce.marcar.length ? Math.round((estado.hechos / cruce.marcar.length) * 100) : 0;

  return (
    <div className="space-y-5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[var(--color-tinta-suave)]">
        <FileSpreadsheet size={16} className="text-[var(--color-exito)]" aria-hidden />
        <b className="font-semibold break-all text-[var(--color-tinta)]">{archivo}</b>·{" "}
        {cruce.leidas === 1 ? "1 fila leída" : `${cifra(cruce.leidas)} filas leídas`}
        {estado.fase === "revisar" && estado.hoja && estado.hoja !== "Revisados" && ` (hoja «${estado.hoja}»)`}
        {!guardando && (
          <button type="button" onClick={onOtroArchivo} className="ml-1 underline underline-offset-2">
            Cambiar archivo
          </button>
        )}
      </p>

      {estado.fase === "revisar" && estado.error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[4px] bg-[var(--color-alerta-fondo)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-alerta)]"
        >
          <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
          {estado.error}
        </p>
      )}

      {guardando && (
        <div>
          <div
            role="progressbar"
            aria-label="Avance de la carga"
            aria-valuenow={porcentaje}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-relleno)]"
          >
            <div className="h-full bg-[var(--color-ambar)] transition-[width] duration-200" style={{ width: `${porcentaje}%` }} />
          </div>
          <p className="mt-2 text-xs text-[var(--color-tinta-suave)]">
            <span className="cifras">{porcentaje} %</span> · No cierres esta ventana hasta que termine.
          </p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { n: cruce.hallazgos, t: "Hallazgos que se marcan", fuerte: true },
          { n: cruce.pdv.length, t: "PDV" },
          { n: cruce.sinNada, t: "Filas sin nada que marcar" },
          { n: cruce.errores, t: "Filas con error", alerta: cruce.errores > 0 },
        ].map((c) => (
          <div
            key={c.t}
            className={`rounded-[6px] border px-3.5 py-3 ${c.fuerte ? "border-[var(--color-tinta)]" : "border-[var(--color-linea)]"}`}
          >
            <dt className="text-[12px] leading-snug text-[var(--color-tinta-suave)]">{c.t}</dt>
            <dd className={`cifras mt-0.5 text-[22px] leading-tight font-semibold ${c.alerta ? "text-[var(--color-alerta)]" : ""}`}>
              {cifra(c.n)}
            </dd>
          </div>
        ))}
      </dl>

      {cruce.pdv.length === 0 ? (
        <p className="rounded-[6px] border border-dashed border-[var(--color-linea)] px-4 py-5 text-center text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
          Ninguna fila del archivo coincide con hallazgos pendientes de la consulta abierta. Revisa abajo qué pasó con
          cada fila.
        </p>
      ) : (
        <section aria-labelledby="se-marcan">
          <h3 id="se-marcan" className="mb-2 text-[14px] font-semibold">
            Se marcan como revisados
          </h3>
          <div className={`${verTodos ? "max-h-[420px] overflow-y-auto" : ""} rounded-[6px] border border-[var(--color-linea)]`}>
            <table className="tabla hidden sm:table">
              <thead>
                <tr>
                  <th scope="col">PDV</th>
                  <th scope="col">Motivos</th>
                  <th scope="col" className="text-right">
                    Hallazgos
                  </th>
                  <th scope="col">Observación</th>
                </tr>
              </thead>
              <tbody>
                {pdv.map((p) => (
                  <tr key={p.codigo}>
                    <td className="max-w-[200px]">
                      <span className="block font-medium">{p.pdv}</span>
                      <span className="cifras block text-xs text-[var(--color-tinta-suave)]">{codigoYConsultores(p)}</span>
                    </td>
                    <td className="max-w-[250px] text-[12px] leading-snug">{p.motivos.join(" · ")}</td>
                    <td className="cifras text-right font-semibold">{cifra(p.n)}</td>
                    <td className="max-w-[220px] text-[12px] leading-snug break-words text-[var(--color-tinta-suave)]">
                      {p.observaciones[0] ?? "—"}
                      {p.observaciones.length > 1 && ` (+${p.observaciones.length - 1})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-[var(--color-linea)] sm:hidden">
              {pdv.map((p) => (
                <li key={p.codigo} className="px-3.5 py-2.5">
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-[14px] font-medium">{p.pdv}</span>
                    <span className="cifras shrink-0 text-[13px] font-semibold">
                      {p.n === 1 ? "1 hallazgo" : `${cifra(p.n)} hallazgos`}
                    </span>
                  </p>
                  <p className="cifras text-xs text-[var(--color-tinta-suave)]">{codigoYConsultores(p)}</p>
                  <p className="mt-1 text-[12px] leading-snug">{p.motivos.join(" · ")}</p>
                  {p.observaciones[0] && (
                    <p className="mt-1 text-[12px] leading-snug break-words text-[var(--color-tinta-suave)]">
                      «{p.observaciones[0]}»
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
          {cruce.pdv.length > pdv.length && (
            <p className="mt-2 text-[12px] text-[var(--color-tinta-suave)]">
              Y {cifra(cruce.pdv.length - pdv.length)} PDV más.{" "}
              {!verTodos && (
                <button type="button" onClick={onVerTodos} className="underline underline-offset-2">
                  Ver todos
                </button>
              )}
            </p>
          )}
        </section>
      )}

      {cruce.noUsadas.length > 0 && (
        <section
          aria-labelledby="no-se-usan"
          className="rounded-[6px] border border-[var(--color-aviso-borde)] bg-[var(--color-aviso-fondo)] px-4 py-3.5"
        >
          <h3 id="no-se-usan" className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-aviso-tinta)]">
            <TriangleAlert size={15} aria-hidden />
            {cruce.noUsadas.length === 1 ? "1 fila no se usa" : `${cifra(cruce.noUsadas.length)} filas no se usan`}
          </h3>
          <ul
            className={`mt-2 space-y-1 text-[13px] leading-snug text-[var(--color-aviso-tinta)] ${
              verNoUsadas ? "max-h-[300px] overflow-y-auto" : ""
            }`}
          >
            {noUsadas.map((n) => (
              <li key={n.fila} className="flex gap-2">
                <span className="cifras w-[72px] shrink-0 font-semibold">Fila {n.fila}</span>
                <span className="min-w-0 break-words">
                  {n.codigo && <span className="cifras">{n.codigo}: </span>}
                  {n.que}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-[13px] text-[var(--color-aviso-tinta)]">
            {cruce.noUsadas.length > noUsadas.length && (
              <>
                Y {cifra(cruce.noUsadas.length - noUsadas.length)} más.{" "}
                {!verNoUsadas && (
                  <button type="button" onClick={onVerNoUsadas} className="underline underline-offset-2">
                    Ver todas
                  </button>
                )}{" "}
              </>
            )}
            <button
              type="button"
              onClick={() => exportarNoUsadas(cruce.noUsadas, archivo)}
              className="font-medium underline underline-offset-2"
            >
              {cruce.noUsadas.length === 1
                ? "Descargar la fila con observaciones"
                : `Descargar las ${cifra(cruce.noUsadas.length)} filas con observaciones`}
            </button>
          </p>
        </section>
      )}

      {cruce.marcar.length > 0 && (
        <p className="flex items-start gap-2 text-[12px] leading-snug text-[var(--color-tinta-suave)]">
          <Info size={14} className="mt-px shrink-0" aria-hidden />
          Quedan a tu nombre con la fecha de hoy. Desde Revisados se pueden devolver a pendientes.
        </p>
      )}
    </div>
  );
}
