"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  Lasso,
  Loader2,
  MapPinned,
  RefreshCw,
  Route,
  TriangleAlert,
  Undo2,
  Upload,
} from "lucide-react";
import { COLORES_RUTA } from "@/lib/tipos";
import {
  calcularReparto,
  colorRuta,
  corregirCoordenadas,
  leerNombres,
  reasignar,
  rutaNueva,
  SIN_ASIGNAR,
  SIN_COORD,
  type OpcionesRutas,
  type ResultadoRutas,
} from "@/lib/rutas";
import {
  columnaLetra,
  ErrorArchivo,
  escribirExcelRutas,
  leerArchivoRutas,
  nombreSalida,
  type ArchivoRutas,
} from "@/lib/rutasExcel";
import MapaRutasCliente from "./MapaRutasCliente";
import type { PuntoRuta } from "./MapaRutas";

/**
 * Generador Rutas: reparte los puntos de un Excel entre personas por
 * cercanía (cluster_rutas.py, en lib/rutas.ts). Todo pasa en el navegador:
 * el archivo no se sube a ningún lado. Se ve en el mapa y se descarga el
 * mismo Excel con NUM_RUTA, PERSONA y la hoja Resumen_Rutas.
 */

const cifra = (n: number) => n.toLocaleString("es-CO");
const km = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 });
const color = (ruta: number | null) => colorRuta(ruta, COLORES_RUTA);

type Generado = { r: ResultadoRutas; op: OpcionesRutas };

export default function GeneradorRutas() {
  const [archivo, setArchivo] = useState<ArchivoRutas | null>(null);
  const [leyendo, setLeyendo] = useState<string | null>(null);
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [personas, setPersonas] = useState("3");
  const [puntos, setPuntos] = useState("14");
  const [parejo, setParejo] = useState(true);
  const [nombresTexto, setNombresTexto] = useState("");
  /** null: quieto. 0 a 1: armando las rutas. */
  const [avance, setAvance] = useState<number | null>(null);
  const [generado, setGenerado] = useState<Generado | null>(null);
  const [errorGenerar, setErrorGenerar] = useState<string | null>(null);
  const [enfocada, setEnfocada] = useState<number | null>(null);
  const [descargando, setDescargando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const trabajador = useRef<Worker | null>(null);
  // Selección a mano: los puntos marcados en el mapa y a quién pasarlos.
  const [seleccionando, setSeleccionando] = useState(false);
  const [seleccion, setSeleccion] = useState<Set<number>>(() => new Set());
  /** "nueva", "sin" (sin asignar) o el número de una ruta. */
  const [destino, setDestino] = useState("nueva");
  const [nombreNueva, setNombreNueva] = useState("");
  /** Lo que había antes de cada asignación a mano, para deshacer. */
  const [historial, setHistorial] = useState<ResultadoRutas[]>([]);
  const [hecho, setHecho] = useState<string | null>(null);

  function limpiarSeleccion() {
    setSeleccionando(false);
    setSeleccion(new Set());
    setDestino("nueva");
    setNombreNueva("");
    setHistorial([]);
    setHecho(null);
  }

  useEffect(() => () => trabajador.current?.terminate(), []);

  // ---------------------------------------------------------- archivo
  async function leer(origen: File | ArchivoRutas, hoja?: string) {
    const nombre = origen instanceof File ? origen.name : origen.nombre;
    setLeyendo(nombre);
    setErrorArchivo(null);
    try {
      const a = await leerArchivoRutas(
        origen instanceof File ? origen : { name: origen.nombre, arrayBuffer: async () => origen.datos },
        hoja
      );
      setArchivo(a);
      setGenerado(null);
      setEnfocada(null);
      setErrorGenerar(null);
      limpiarSeleccion();
    } catch (e) {
      if (!(e instanceof ErrorArchivo)) console.error("[rutas archivo]", e);
      setErrorArchivo(e instanceof ErrorArchivo ? e.message : "No se pudo leer el archivo.");
    } finally {
      setLeyendo(null);
    }
  }

  const previa = useMemo(() => (archivo ? corregirCoordenadas(archivo.latCrudas, archivo.lonCrudas) : null), [archivo]);
  const conCoordenadas = previa ? previa.lat.filter((v) => v !== null).length : 0;

  // ---------------------------------------------------------- reparto
  const k = Number(personas);
  const m = Number(puntos);
  const numerosBien = Number.isInteger(k) && k >= 1 && Number.isInteger(m) && m >= 1;
  const nombres = useMemo(() => leerNombres(nombresTexto), [nombresTexto]);

  const pista = useMemo((): { texto: string; tipo: "bien" | "aviso" | "error" } | null => {
    if (!archivo) return null;
    if (!numerosBien) return { texto: "Personas y puntos por persona deben ser números enteros desde 1.", tipo: "error" };
    if (conCoordenadas === 0) return { texto: "Ningún punto tiene coordenadas válidas.", tipo: "error" };
    if (k > conCoordenadas) {
      return { texto: `Hay más personas (${cifra(k)}) que puntos con coordenadas (${cifra(conCoordenadas)}).`, tipo: "error" };
    }
    const r = calcularReparto(conCoordenadas, k, m, parejo);
    const cupos = `${cifra(k)} × ${cifra(m)} = ${cifra(k * m)} cupos para ${cifra(conCoordenadas)} puntos`;
    if (r.fuera) {
      return {
        texto: `${cupos}: ${cifra(r.fuera)} puntos, los más alejados, quedan ${SIN_ASIGNAR}. Sube las personas o los puntos por persona para repartirlos todos.`,
        tipo: "aviso",
      };
    }
    if (!parejo) return { texto: `${cupos}. Hasta ${cifra(m)} por persona; la cercanía decide cuántos le tocan a cada una.`, tipo: "bien" };
    return {
      texto: `${cupos}. Cada persona queda con ${r.minimo === r.cap ? cifra(r.cap) : `${cifra(r.minimo)} o ${cifra(r.cap)}`} puntos.`,
      tipo: "bien",
    };
  }, [archivo, numerosBien, conCoordenadas, k, m, parejo]);

  const opciones: OpcionesRutas = { personas: k, puntosPorPersona: m, parejo, nombres };
  const cambiado =
    generado !== null &&
    (generado.op.personas !== k ||
      generado.op.puntosPorPersona !== m ||
      generado.op.parejo !== parejo ||
      generado.op.nombres.join("\n") !== nombres.join("\n"));

  function generar() {
    if (!archivo || pista?.tipo === "error" || avance !== null) return;
    setErrorGenerar(null);
    setAvance(0);
    const op = { ...opciones };
    const terminar = (g: Generado | null, error?: string) => {
      trabajador.current?.terminate();
      trabajador.current = null;
      setAvance(null);
      if (g) {
        setGenerado(g);
        setEnfocada(null);
        limpiarSeleccion();
      }
      if (error) setErrorGenerar(error);
    };

    let w: Worker | null = null;
    try {
      w = new Worker(new URL("../lib/rutas.worker.ts", import.meta.url));
    } catch {
      w = null;
    }
    if (!w) {
      // Sin trabajador en segundo plano (navegador muy viejo): se arma aquí mismo.
      import("@/lib/rutas").then(({ generarRutas, ErrorRutas }) => {
        try {
          terminar({ r: generarRutas(archivo.latCrudas, archivo.lonCrudas, op), op });
        } catch (e) {
          terminar(null, e instanceof ErrorRutas ? e.message : "No se pudieron armar las rutas.");
        }
      });
      return;
    }
    trabajador.current = w;
    w.onmessage = (e: MessageEvent<{ tipo: string; hecho?: number; resultado?: ResultadoRutas; mensaje?: string }>) => {
      if (e.data.tipo === "avance") setAvance(e.data.hecho ?? 0);
      else if (e.data.tipo === "listo") terminar({ r: e.data.resultado!, op });
      else terminar(null, e.data.mensaje ?? "No se pudieron armar las rutas.");
    };
    w.onerror = () => terminar(null, "No se pudieron armar las rutas. Recarga la página e intenta de nuevo.");
    w.postMessage({ lat: archivo.latCrudas, lon: archivo.lonCrudas, opciones: op });
  }

  async function descargar() {
    if (!archivo || !generado) return;
    setDescargando(true);
    try {
      const blob = await escribirExcelRutas(archivo, generado.r, generado.op);
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = nombreSalida(archivo.nombre);
      enlace.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      console.error("[rutas excel]", e);
      setErrorGenerar("No se pudo armar el Excel. Intenta de nuevo.");
    } finally {
      setDescargando(false);
    }
  }

  // ---------------------------------------------------------- mapa
  const puntosMapa = useMemo((): PuntoRuta[] => {
    if (!archivo || !previa) return [];
    const lat = generado ? generado.r.lat : previa.lat;
    const lon = generado ? generado.r.lon : previa.lon;
    const lista: PuntoRuta[] = [];
    archivo.info.forEach((info, i) => {
      if (lat[i] === null || lon[i] === null) return;
      lista.push({
        i,
        lat: lat[i]!,
        lon: lon[i]!,
        ruta: generado ? generado.r.ruta[i] : null,
        persona: generado ? generado.r.persona[i] : null,
        info,
      });
    });
    return lista;
  }, [archivo, previa, generado]);

  const trabajando = avance !== null;
  const r = generado?.r;

  // ---------------------------------------------------------- selección a mano
  const nueva = r ? rutaNueva(r) : 1;
  /** Cuántos seleccionados hay sin asignar y de cada ruta. */
  const desglose = useMemo(() => {
    if (!r) return "";
    const cuenta = new Map<number | null, number>();
    for (const i of seleccion) cuenta.set(r.ruta[i], (cuenta.get(r.ruta[i]) ?? 0) + 1);
    const nombreDe = new Map(r.resumen.map((x) => [x.num, x.persona]));
    return [...cuenta.entries()]
      .sort(([a], [b]) => (a ?? 0) - (b ?? 0))
      .map(([num, n]) => `${cifra(n)} ${num === null ? "sin asignar" : `de ${nombreDe.get(num) ?? `la ruta ${num}`}`}`)
      .join(", ");
  }, [r, seleccion]);

  const alSeleccionar = useCallback((indices: number[], modo: "agregar" | "alternar") => {
    setHecho(null);
    setSeleccion((s) => {
      const n = new Set(s);
      for (const i of indices) {
        if (modo === "alternar" && n.has(i)) n.delete(i);
        else n.add(i);
      }
      return n;
    });
  }, []);

  function asignar() {
    if (!generado || seleccion.size === 0) return;
    const num = destino === "sin" ? null : destino === "nueva" ? nueva : Number(destino);
    const nuevo = reasignar(generado.r, seleccion, num, destino === "nueva" ? nombreNueva : undefined);
    if (nuevo === generado.r) {
      setHecho("Esos puntos ya estaban ahí.");
      return;
    }
    const quien = num === null ? SIN_ASIGNAR : nuevo.resumen.find((x) => x.num === num)?.persona ?? `PERSONA ${num}`;
    setHistorial((h) => [...h, generado.r]);
    setGenerado({ r: nuevo, op: generado.op });
    setHecho(`${cifra(seleccion.size)} ${seleccion.size === 1 ? "punto pasó" : "puntos pasaron"} a ${quien}${num !== null ? ` (ruta ${num})` : ""}.`);
    setSeleccion(new Set());
    setNombreNueva("");
    // Lo siguiente que se seleccione va, de entrada, a la misma persona.
    if (num !== null) setDestino(String(num));
  }

  function deshacer() {
    if (!generado || historial.length === 0) return;
    const previo = historial[historial.length - 1];
    setHistorial((h) => h.slice(0, -1));
    setGenerado({ r: previo, op: generado.op });
    setHecho("Se deshizo el último cambio.");
    if (destino !== "nueva" && destino !== "sin" && !previo.resumen.some((x) => x.num === Number(destino))) setDestino("nueva");
  }

  // Esc termina de seleccionar (lo seleccionado se queda).
  useEffect(() => {
    if (!seleccionando) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSeleccionando(false);
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [seleccionando]);

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
      {/* ------------------------------------------------ configuración */}
      <div className="space-y-5">
        <section aria-labelledby="rutas-archivo" className="tarjeta p-5">
          <h2 id="rutas-archivo" className="rotulo">
            1 · Archivo
          </h2>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setArrastrando(true);
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastrando(false);
              const f = e.dataTransfer.files?.[0];
              if (f) leer(f);
            }}
            className={`mt-3 rounded-[6px] border-2 border-dashed px-4 py-6 text-center ${
              arrastrando ? "border-[var(--color-tinta)] bg-[var(--color-seleccion)]" : "border-[var(--color-linea)]"
            }`}
          >
            <FileSpreadsheet size={26} className="mx-auto text-[var(--color-tinta-suave)]" aria-hidden />
            <p className="mt-2 text-[14px] font-medium">{archivo ? archivo.nombre : "Arrastra el Excel aquí"}</p>
            <p className="mt-1 text-[12.5px] text-[var(--color-tinta-suave)]">
              Con columnas LATITUD y LONGITUD en la fila 1. El archivo no sale de tu computador.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xlsm"
              className="sr-only"
              aria-label="Elegir el Excel de puntos"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) leer(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={leyendo !== null}
              onClick={() => inputRef.current?.click()}
              className={`boton mt-4 ${archivo ? "boton-secundario" : "boton-primario"}`}
            >
              {leyendo ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Upload size={16} aria-hidden />}
              {leyendo ? `Leyendo ${leyendo}…` : archivo ? "Cambiar archivo" : "Elegir archivo"}
            </button>
          </div>

          {errorArchivo && (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-[6px] bg-[var(--color-alerta-fondo)] px-3 py-2.5 text-[13px] text-[var(--color-alerta)]">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
              {errorArchivo}
            </p>
          )}

          {archivo && previa && (
            <div className="mt-4 space-y-3">
              {archivo.hojas.length > 1 && (
                <div>
                  <label htmlFor="rutas-hoja" className="campo-etiqueta">
                    Hoja
                  </label>
                  <select
                    id="rutas-hoja"
                    value={archivo.hoja}
                    onChange={(e) => leer(archivo, e.target.value)}
                    className="campo"
                  >
                    {archivo.hojas.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <dl className="grid grid-cols-2 gap-2 text-[13px]" aria-label="Puntos del archivo">
                <div className="rounded-[6px] bg-[var(--color-relleno)] px-3 py-2">
                  <dt className="text-[var(--color-tinta-suave)]">Puntos</dt>
                  <dd className="cifras text-[18px] font-semibold">{cifra(archivo.filas.length)}</dd>
                </div>
                <div className="rounded-[6px] bg-[var(--color-relleno)] px-3 py-2">
                  <dt className="text-[var(--color-tinta-suave)]">Con coordenadas</dt>
                  <dd className="cifras text-[18px] font-semibold">{cifra(conCoordenadas)}</dd>
                </div>
              </dl>
              <p className="text-[12.5px] leading-snug text-[var(--color-tinta-suave)]">
                Coordenadas en {archivo.columnas.lat} y {archivo.columnas.lon}.
                {archivo.filas.length - conCoordenadas > 0 &&
                  ` ${cifra(archivo.filas.length - conCoordenadas)} sin coordenadas válidas quedan como «${SIN_COORD}».`}{" "}
                Las que venían con coma decimal, sin signo, al revés o sin punto se corrigen solas.
              </p>
              <p className="text-[12.5px] leading-snug text-[var(--color-tinta-suave)]">
                {archivo.reutiliza
                  ? `Las rutas se escriben en las columnas que ya trae el archivo: ${columnaLetra(archivo.colRuta)} y ${columnaLetra(archivo.colPersona)}.`
                  : `Las rutas van en ${columnaLetra(archivo.colRuta)} (NUM_RUTA) y ${columnaLetra(archivo.colPersona)} (PERSONA), justo después de la última columna con datos.`}
              </p>
            </div>
          )}
        </section>

        <section aria-labelledby="rutas-reparto" className="tarjeta p-5">
          <h2 id="rutas-reparto" className="rotulo">
            2 · Reparto
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="rutas-personas" className="campo-etiqueta">
                Personas
              </label>
              <input
                id="rutas-personas"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={personas}
                onChange={(e) => setPersonas(e.target.value)}
                className="campo cifras"
              />
            </div>
            <div>
              <label htmlFor="rutas-puntos" className="campo-etiqueta">
                Puntos por persona
              </label>
              <input
                id="rutas-puntos"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={puntos}
                onChange={(e) => setPuntos(e.target.value)}
                className="campo cifras"
              />
            </div>
          </div>

          <label className="mt-3 flex items-start gap-2.5 text-[13.5px]">
            <input type="checkbox" checked={parejo} onChange={(e) => setParejo(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-acento,var(--color-tinta))]" />
            <span>
              Repartir parejo
              <span className="block text-[12.5px] text-[var(--color-tinta-suave)]">
                Todas las rutas con la misma cantidad (±1). Sin marcar, solo se respeta el máximo y decide la cercanía.
              </span>
            </span>
          </label>

          <details className="group mt-3">
            <summary className="cursor-pointer text-[13.5px] font-medium text-[var(--color-tinta)]">
              Nombres de las personas <span className="font-normal text-[var(--color-tinta-suave)]">(opcional)</span>
            </summary>
            <label htmlFor="rutas-nombres" className="sr-only">
              Nombres, uno por línea
            </label>
            <textarea
              id="rutas-nombres"
              rows={4}
              value={nombresTexto}
              onChange={(e) => setNombresTexto(e.target.value)}
              placeholder={"Uno por línea, en el orden de las rutas (1 es la más al norte).\nVacío: PERSONA 1, PERSONA 2…"}
              className="campo mt-2 min-h-[96px] py-2"
            />
            {nombres.length > 0 && numerosBien && (
              <p className="mt-1 text-[12px] text-[var(--color-tinta-suave)]">
                {cifra(nombres.length)} de {cifra(k)} nombres
                {nombres.length < k ? `; las demás quedan como PERSONA #.` : nombres.length > k ? `; sobran ${cifra(nombres.length - k)}.` : "."}
              </p>
            )}
          </details>

          {pista && (
            <p
              className={`mt-4 rounded-[6px] px-3 py-2.5 text-[13px] leading-snug ${
                pista.tipo === "error"
                  ? "bg-[var(--color-alerta-fondo)] text-[var(--color-alerta)]"
                  : pista.tipo === "aviso"
                    ? "bg-[var(--color-aviso-fondo)] text-[var(--color-aviso-tinta)]"
                    : "bg-[var(--color-relleno)] text-[var(--color-tinta-suave)]"
              }`}
            >
              {pista.texto}
            </p>
          )}

          <button
            type="button"
            onClick={generar}
            disabled={!archivo || pista?.tipo === "error" || trabajando}
            className="boton boton-primario mt-4 w-full"
          >
            {trabajando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : generado ? <RefreshCw size={16} aria-hidden /> : <Route size={16} aria-hidden />}
            {trabajando
              ? `Armando ${cifra(k)} rutas… ${Math.round((avance ?? 0) * 100)} %`
              : generado
                ? "Generar otra vez"
                : "Generar rutas"}
          </button>
          {generado && !trabajando && (
            <p className="mt-2 text-[12px] leading-snug text-[var(--color-tinta-suave)]">
              {cambiado
                ? "Cambiaste el reparto: genera otra vez para verlo en el mapa y en el Excel."
                : r?.aMano
                  ? `Generar otra vez borra lo que cambiaste a mano (${cifra(r.aMano)} ${r.aMano === 1 ? "punto" : "puntos"}).`
                  : "Cada vez que generas puede salir un reparto un poco distinto, igual de cercano."}
            </p>
          )}
          {errorGenerar && (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-[6px] bg-[var(--color-alerta-fondo)] px-3 py-2.5 text-[13px] text-[var(--color-alerta)]">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
              {errorGenerar}
            </p>
          )}
        </section>
      </div>

      {/* ------------------------------------------------ mapa y rutas */}
      <section aria-labelledby="rutas-mapa" className="tarjeta overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-linea)] px-5 py-3.5">
          <div>
            <h2 id="rutas-mapa" className="text-[15px] font-semibold">
              {r ? `${cifra(r.resumen.length)} rutas` : "Previsualización"}
            </h2>
            <p className="text-[12.5px] text-[var(--color-tinta-suave)]">
              {r
                ? `${cifra(r.resumen.reduce((a, x) => a + x.puntos, 0))} puntos repartidos${enfocada ? ` · viendo la ruta ${enfocada}` : ""}`
                : archivo
                  ? `${cifra(puntosMapa.length)} puntos en el mapa. Genera las rutas para verlas por color.`
                  : "Sube el Excel para ver los puntos aquí."}
            </p>
          </div>
          {r && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={seleccionando}
                onClick={() => {
                  setSeleccionando((s) => !s);
                  setHecho(null);
                }}
                className={`boton boton-secundario ${seleccionando ? "border-[var(--color-tinta)] bg-[var(--color-seleccion)]" : ""}`}
              >
                <Lasso size={16} aria-hidden />
                Seleccionar puntos
              </button>
              <button type="button" onClick={descargar} disabled={descargando} className="boton boton-primario">
                {descargando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Download size={16} aria-hidden />}
                Descargar Excel
              </button>
            </div>
          )}
        </div>

        <div className="h-[56vh] min-h-[340px] border-b border-[var(--color-linea)]">
          {puntosMapa.length > 0 ? (
            <MapaRutasCliente
              puntos={puntosMapa}
              generado={!!r}
              colorDe={color}
              enfocada={enfocada}
              claveVista={`${archivo?.nombre}|${archivo?.hoja}`}
              seleccionando={!!r && seleccionando}
              seleccion={seleccion}
              onSeleccion={alSeleccionar}
            />
          ) : (
            <div className="grid h-full place-items-center bg-[var(--color-mapa,var(--color-relleno))] px-6 text-center">
              <div>
                <MapPinned size={30} className="mx-auto text-[var(--color-tinta-suave)]" aria-hidden />
                <p className="mt-2 text-[13.5px] text-[var(--color-tinta-suave)]">
                  {archivo ? "Ningún punto tiene coordenadas para mostrar." : "Aquí vas a ver los puntos y, después, las rutas."}
                </p>
              </div>
            </div>
          )}
        </div>

        {r && (seleccionando || seleccion.size > 0 || historial.length > 0) && (
          <div aria-label="Puntos seleccionados" role="group" className="space-y-2.5 border-b border-[var(--color-linea)] bg-[var(--color-relleno)] px-5 py-3.5">
            <p className="text-[13px] leading-snug" aria-live="polite">
              {seleccion.size > 0 ? (
                <>
                  <span className="cifras font-semibold">
                    {cifra(seleccion.size)} {seleccion.size === 1 ? "punto seleccionado" : "puntos seleccionados"}
                  </span>
                  <span className="text-[var(--color-tinta-suave)]">: {desglose}.</span>
                </>
              ) : seleccionando ? (
                <span className="text-[var(--color-tinta-suave)]">
                  Dibuja alrededor de los puntos que quieras (arrastrando) o tócalos uno por uno; tocar uno marcado lo quita. Para mover el
                  mapa, termina de seleccionar.
                </span>
              ) : (
                <span className="text-[var(--color-tinta-suave)]">Toca «Seleccionar puntos» para marcar más.</span>
              )}
              {hecho && <span className="block font-medium text-[var(--color-exito,var(--color-tinta))]">{hecho}</span>}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[180px]">
                <label htmlFor="rutas-destino" className="campo-etiqueta">
                  Pasarlos a
                </label>
                <select id="rutas-destino" value={destino} onChange={(e) => setDestino(e.target.value)} className="campo">
                  <option value="nueva">Persona nueva ({nueva})</option>
                  {r.resumen.map((x) => (
                    <option key={x.num} value={String(x.num)}>
                      {x.num} · {x.persona}
                    </option>
                  ))}
                  <option value="sin">Sin asignar</option>
                </select>
              </div>
              {destino === "nueva" && (
                <div className="min-w-[160px] flex-1 sm:max-w-[240px]">
                  <label htmlFor="rutas-nombre-nueva" className="campo-etiqueta">
                    Nombre <span className="font-normal text-[var(--color-tinta-suave)]">(opcional)</span>
                  </label>
                  <input
                    id="rutas-nombre-nueva"
                    value={nombreNueva}
                    onChange={(e) => setNombreNueva(e.target.value)}
                    placeholder={`PERSONA ${nueva}`}
                    autoComplete="off"
                    className="campo"
                  />
                </div>
              )}
              <button type="button" onClick={asignar} disabled={seleccion.size === 0} className="boton boton-primario">
                Asignar
              </button>
              <button type="button" onClick={() => setSeleccion(new Set())} disabled={seleccion.size === 0} className="boton boton-secundario">
                Limpiar selección
              </button>
              {historial.length > 0 && (
                <button type="button" onClick={deshacer} className="boton boton-secundario">
                  <Undo2 size={15} aria-hidden />
                  Deshacer
                </button>
              )}
            </div>
          </div>
        )}

        {r && (
          <div className="p-4">
            {r.avisos.length > 0 && (
              <ul className="mb-3 space-y-1.5">
                {r.avisos.map((a) => (
                  <li key={a} className="flex items-start gap-2 rounded-[6px] bg-[var(--color-aviso-fondo)] px-3 py-2 text-[12.5px] text-[var(--color-aviso-tinta)]">
                    <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
                    {a}
                  </li>
                ))}
              </ul>
            )}
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="rotulo">Rutas · toca una para verla sola</p>
              {enfocada !== null && (
                <button type="button" onClick={() => setEnfocada(null)} className="text-[12.5px] font-medium text-[var(--color-acento-tinta,var(--color-tinta))] underline-offset-2 hover:underline">
                  Ver todas
                </button>
              )}
            </div>
            <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Rutas generadas">
              {r.resumen.map((x) => (
                <li key={x.num}>
                  <button
                    type="button"
                    aria-pressed={enfocada === x.num}
                    onClick={() => setEnfocada(enfocada === x.num ? null : x.num)}
                    className={`flex w-full items-center gap-3 rounded-[8px] border px-3 py-2 text-left transition-colors ${
                      enfocada === x.num
                        ? "border-[var(--color-tinta)] bg-[var(--color-seleccion)]"
                        : "border-[var(--color-linea)] hover:bg-[var(--color-hover)]"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-white"
                      style={{ background: color(x.num) }}
                    >
                      {x.num}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{x.persona}</span>
                      <span className="cifras block text-[12px] text-[var(--color-tinta-suave)]">
                        {cifra(x.puntos)} puntos · {km(x.distPromKm)} km prom. · {km(x.distMaxKm)} km máx.
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {(r.sinAsignar > 0 || r.sinCoordenadas > 0) && (
              <p className="mt-3 text-[12.5px] text-[var(--color-tinta-suave)]">
                {[
                  r.sinAsignar > 0 && `${cifra(r.sinAsignar)} ${SIN_ASIGNAR.toLowerCase()} (círculos blancos en el mapa)`,
                  r.sinCoordenadas > 0 && `${cifra(r.sinCoordenadas)} ${SIN_COORD.toLowerCase()}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                . En el Excel quedan con ese texto en PERSONA.
              </p>
            )}
            <p className="mt-3 text-[12px] text-[var(--color-tinta-suave)]">
              El Excel ({nombreSalida(archivo!.nombre)}) es tu archivo con la ruta en la columna {columnaLetra(archivo!.colRuta)}, la
              persona en la {columnaLetra(archivo!.colPersona)} y la hoja Resumen_Rutas con los puntos y las distancias de cada ruta.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
