"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import {
  COLUMNAS_PLANTILLA,
  descargarPlantillaVacia,
  etiquetaDeCampo,
  exportarObservaciones,
  leerPlantilla,
  type ModoCarga,
  type ResultadoLectura,
} from "@/lib/excel";
import { cuando } from "@/lib/fechas";
import EncabezadoPagina from "./EncabezadoPagina";
import { cifra } from "./ConsultaAthena";

const TAM_LOTE = 500;
/** Filas por consulta al comparar con la cartera antes de aplicar. */
const TAM_PREVIA = 1000;

const MODOS: { id: ModoCarga; titulo: string; corto: string; detalle: string }[] = [
  {
    id: "reemplazar",
    titulo: "Cargar la plantilla completa",
    corto: "Plantilla completa",
    detalle:
      "Para el archivo maestro del ciclo. Crea los puntos nuevos y reescribe por completo los que ya existan. Requiere columna CICLO.",
  },
  {
    id: "actualizar",
    titulo: "Actualizar solo lo que traiga el archivo",
    corto: "Actualizar columnas",
    detalle:
      "Para correcciones masivas: reasignar consultores, arreglar direcciones, mover coordenadas. Solo toca las columnas presentes en el Excel y no crea puntos nuevos.",
  },
  {
    id: "agregar",
    titulo: "Agregar únicamente los puntos nuevos",
    corto: "Agregar nuevos",
    detalle: "Inserta lo que no exista y deja intacto lo que ya está en la cartera.",
  },
];

/** Cuántas filas del archivo ya están en la cartera y cuántas no. */
type Previa = { existen: number; nuevas: number };

type Estado =
  | { fase: "reposo" }
  | { fase: "leyendo"; archivo: string }
  | { fase: "revisando"; archivo: string; lectura: ResultadoLectura; revisadas: number }
  | { fase: "confirmar"; archivo: string; lectura: ResultadoLectura; previa: Previa | null }
  | { fase: "subiendo"; archivo: string; lectura: ResultadoLectura; enviadas: number; total: number }
  | {
      fase: "listo";
      archivo: string;
      modo: ModoCarga;
      guardadas: number;
      omitidas: number;
      noEncontradas: string[];
      avisoBitacora: string | null;
      lectura: ResultadoLectura;
    }
  | { fase: "error"; mensaje: string };

type Resumen = {
  ciclo: string | null;
  ciclos: { ciclo: string; puntos: number }[];
  ultimaCarga: { archivo: string; cargado_por: string | null; created_at: string } | null;
};

function Paso({
  numero,
  titulo,
  detalle,
  estado,
}: {
  numero: number;
  titulo: string;
  detalle: string;
  estado: "hecho" | "actual" | "pendiente";
}) {
  return (
    <li
      aria-current={estado === "actual" ? "step" : undefined}
      className={`flex min-w-0 items-center gap-3 rounded-[6px] px-3.5 py-3 ${
        estado === "actual"
          ? "border-2 border-[var(--color-tinta)] bg-[var(--color-papel)]"
          : estado === "hecho"
            ? "border border-[var(--color-linea)] bg-[var(--color-papel)]"
            : "border border-dashed border-[var(--color-linea)] text-[var(--color-tinta-suave)]"
      }`}
    >
      <span
        aria-hidden
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold ${
          estado === "hecho"
            ? "bg-[var(--color-exito)] text-[var(--color-sobre-exito)]"
            : estado === "actual"
              ? "bg-[var(--color-tinta)] text-[var(--color-sobre-tinta)]"
              : "border border-[var(--color-marcador)]"
        }`}
      >
        {estado === "hecho" ? <Check size={15} strokeWidth={2.5} /> : numero}
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-[var(--color-tinta-suave)]">
          {numero} · {titulo}
          {estado === "hecho" && <span className="sr-only"> (listo)</span>}
        </span>
        <span className={`block truncate text-[13px] ${estado === "actual" ? "font-semibold" : "font-medium"}`}>
          {detalle}
        </span>
      </span>
    </li>
  );
}

export default function Cargador() {
  const [modo, setModo] = useState<ModoCarga>("reemplazar");
  const [estado, setEstado] = useState<Estado>({ fase: "reposo" });
  const [arrastrando, setArrastrando] = useState(false);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Si se cancela mientras se compara con la cartera, la comparación vieja ya no manda. */
  const turno = useRef(0);

  function cargarResumen() {
    fetch("/api/admin/resumen")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setResumen(j as Resumen))
      .catch(() => {});
  }

  useEffect(cargarResumen, []);

  function reiniciar() {
    turno.current++;
    setEstado({ fase: "reposo" });
  }

  /** Compara las filas con la cartera, de a TAM_PREVIA por consulta. null si no se pudo. */
  async function comparar(lectura: ResultadoLectura, archivo: string, mio: number): Promise<Previa | null> {
    const claves = lectura.filas.map((f) => ({ id: f.id_pdv, ciclo: f.ciclo ?? "" }));
    let existen = 0;
    let nuevas = 0;
    for (let i = 0; i < claves.length; i += TAM_PREVIA) {
      if (turno.current !== mio) return null;
      setEstado({ fase: "revisando", archivo, lectura, revisadas: i });
      try {
        const r = await fetch("/api/admin/upload/previa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claves: claves.slice(i, i + TAM_PREVIA), tieneCiclo: lectura.tieneCiclo }),
        });
        if (!r.ok) return null;
        const j = (await r.json()) as Previa;
        existen += j.existen;
        nuevas += j.nuevas;
      } catch {
        return null;
      }
    }
    return { existen, nuevas };
  }

  async function leer(archivo: File) {
    const mio = ++turno.current;
    setEstado({ fase: "leyendo", archivo: archivo.name });

    let lectura: ResultadoLectura;
    try {
      lectura = leerPlantilla(await archivo.arrayBuffer());
    } catch (e) {
      setEstado({
        fase: "error",
        mensaje:
          e instanceof Error
            ? e.message
            : "No pudimos leer el archivo. Verifica que sea .xlsx y no esté protegido con contraseña.",
      });
      return;
    }

    if (lectura.filas.length === 0) {
      setEstado({
        fase: "error",
        mensaje: "El archivo no tiene filas con columna ID. Revisa que sea la plantilla correcta.",
      });
      return;
    }

    const previa = await comparar(lectura, archivo.name, mio);
    if (turno.current !== mio) return;
    setEstado({ fase: "confirmar", archivo: archivo.name, lectura, previa });
  }

  async function aplicar(archivo: string, lectura: ResultadoLectura) {
    const total = lectura.filas.length;
    let guardadas = 0;
    let omitidas = 0;
    let avisoBitacora: string | null = null;
    const noEncontradas: string[] = [];

    for (let i = 0; i < total; i += TAM_LOTE) {
      const lote = lectura.filas.slice(i, i + TAM_LOTE);
      const esFinal = i + TAM_LOTE >= total;

      setEstado({ fase: "subiendo", archivo, lectura, enviadas: i, total });

      const res = await fetch("/api/admin/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filas: lote,
          archivo,
          modo,
          tieneCiclo: lectura.tieneCiclo,
          final: esFinal,
          resumen: esFinal
            ? {
                filas: lectura.total,
                filasOk: total,
                filasError: lectura.descartadas.length,
                detalle: lectura.descartadas.slice(0, 100),
              }
            : undefined,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setEstado({
          fase: "error",
          mensaje: `Se procesaron ${cifra(guardadas)} de ${cifra(total)} filas y el proceso se detuvo. ${
            json.error ?? "El servidor rechazó el lote."
          }`,
        });
        return;
      }

      guardadas += json.guardadas ?? 0;
      omitidas += json.omitidas ?? 0;
      if (json.avisoBitacora) avisoBitacora = json.avisoBitacora;
      for (const id of json.noEncontradas ?? []) {
        if (noEncontradas.length < 50) noEncontradas.push(id);
      }
    }

    setEstado({ fase: "listo", archivo, modo, guardadas, omitidas, noEncontradas, avisoBitacora, lectura });
    cargarResumen();
    // La barra del panel muestra el ciclo actual: puede haber cambiado.
    window.dispatchEvent(new Event("cartera:estado"));
  }

  function alSoltar(e: React.DragEvent) {
    e.preventDefault();
    setArrastrando(false);
    const archivo = e.dataTransfer.files?.[0];
    if (archivo) leer(archivo);
  }

  // ------------------------------------------------------------ pasos
  const archivo = "archivo" in estado ? estado.archivo : null;
  const lectura = "lectura" in estado ? estado.lectura : null;
  const paso =
    estado.fase === "revisando" || estado.fase === "confirmar"
      ? 3
      : estado.fase === "subiendo"
        ? 4
        : estado.fase === "listo"
          ? 5
          : 2;
  const estadoPaso = (n: number) => (n < paso ? "hecho" : n === paso ? "actual" : "pendiente");
  const modoActual = MODOS.find((m) => m.id === modo)!;

  const totalHoy = resumen?.ciclos.reduce((a, c) => a + c.puntos, 0) ?? null;
  const ciclosArchivo = lectura
    ? [...new Set(lectura.filas.map((f) => f.ciclo ?? ""))].filter((c) => c !== "")
    : [];
  const traeCoordenadas =
    lectura !== null &&
    lectura.camposPresentes.includes("latitud") &&
    lectura.camposPresentes.includes("longitud");
  /** Los puntos que hoy hay en los ciclos que trae el archivo. */
  const hoyEnCiclos =
    resumen && ciclosArchivo.length > 0
      ? resumen.ciclos.filter((c) => ciclosArchivo.includes(c.ciclo)).reduce((a, c) => a + c.puntos, 0)
      : null;

  // ------------------------------------------------------------ pantalla
  return (
    <div className="space-y-6">
      <EncabezadoPagina
        titulo="Cargar plantilla"
        descripcion={
          totalHoy === null
            ? "Sube el Excel de la cartera en cuatro pasos. Nada cambia hasta el último."
            : `Hoy la cartera tiene ${cifra(totalHoy)} puntos${resumen?.ciclo ? `; el ciclo más reciente es el ${resumen.ciclo}` : ""}.`
        }
        acciones={
          <button
            type="button"
            onClick={descargarPlantillaVacia}
            title={`Excel vacío con las ${COLUMNAS_PLANTILLA.length} columnas en orden`}
            className="boton boton-secundario"
          >
            <Download size={16} aria-hidden />
            Plantilla vacía
          </button>
        }
      />

      <ol aria-label="Pasos de la carga" className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <Paso numero={1} titulo="Qué quieres hacer" detalle={modoActual.corto} estado="hecho" />
        <Paso numero={2} titulo="Archivo" detalle={archivo ?? "Elige el Excel"} estado={estadoPaso(2)} />
        <Paso numero={3} titulo="Revisar" detalle="Antes de aplicar" estado={estadoPaso(3)} />
        <Paso
          numero={4}
          titulo="Aplicar"
          detalle={estado.fase === "listo" ? "Listo" : "Se guarda en la cartera"}
          estado={estadoPaso(4)}
        />
      </ol>

      {estado.fase === "error" && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[4px] bg-[var(--color-alerta-fondo)] px-3 py-3 text-[13px] leading-snug text-[var(--color-alerta)]"
        >
          <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
          {estado.mensaje}
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {/* ---------------------------------------------------- 1 y 2: modo y archivo */}
          {(paso === 2) && (
            <>
              <fieldset className="tarjeta px-4 pt-3 pb-4 sm:px-5">
                <legend className="sr-only">Qué quieres hacer</legend>
                <p className="mb-3 text-[15px] font-semibold" aria-hidden>
                  1 · Qué quieres hacer
                </p>
                <div className="grid gap-3 xl:grid-cols-3">
                  {MODOS.map((m) => (
                    <label
                      key={m.id}
                      className={`flex cursor-pointer gap-3 rounded-[6px] border p-3.5 ${
                        modo === m.id
                          ? "border-[var(--color-tinta)] bg-[var(--color-sutil)] shadow-[inset_0_0_0_1px_var(--color-tinta)]"
                          : "border-[var(--color-linea)] hover:border-[var(--color-tinta-suave)]"
                      }`}
                    >
                      <input
                        type="radio"
                        name="modo"
                        value={m.id}
                        checked={modo === m.id}
                        disabled={estado.fase === "leyendo"}
                        onChange={() => {
                          setModo(m.id);
                          reiniciar();
                        }}
                        className="mt-1 shrink-0"
                      />
                      <span>
                        <span className="block text-sm font-semibold">{m.titulo}</span>
                        <span className="mt-1 block text-[13px] leading-snug text-[var(--color-tinta-suave)]">
                          {m.detalle}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setArrastrando(true);
                }}
                onDragLeave={() => setArrastrando(false)}
                onDrop={alSoltar}
                className={`rounded-[6px] border-2 border-dashed px-6 py-10 text-center ${
                  arrastrando
                    ? "border-[var(--color-tinta)] bg-[var(--color-seleccion)]"
                    : "border-[var(--color-linea)] bg-[var(--color-papel)]"
                }`}
              >
                <p className="text-[13px] font-semibold text-[var(--color-tinta-suave)]">2 · Archivo</p>
                <FileSpreadsheet size={30} className="mx-auto mt-3 text-[var(--color-tinta-suave)]" aria-hidden />
                <p className="mt-3 text-[15px] font-medium">Arrastra el archivo aquí</p>
                <p className="mt-1 text-[13px] text-[var(--color-tinta-suave)]">
                  {modo === "reemplazar"
                    ? `La plantilla maestra con sus ${COLUMNAS_PLANTILLA.length} columnas, por ejemplo 101_BOGOTA_12_SEP.xlsx`
                    : "Cualquier Excel con columna ID y las columnas que quieras cambiar"}
                </p>

                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls,.xlsm"
                  className="sr-only"
                  aria-label="Elegir el archivo"
                  onChange={(e) => {
                    const elegido = e.target.files?.[0];
                    if (elegido) leer(elegido);
                    e.target.value = "";
                  }}
                />

                <button
                  type="button"
                  disabled={estado.fase === "leyendo"}
                  onClick={() => inputRef.current?.click()}
                  className="boton boton-primario mt-5"
                >
                  {estado.fase === "leyendo" ? (
                    <Loader2 size={16} className="animate-spin" aria-hidden />
                  ) : (
                    <Upload size={16} aria-hidden />
                  )}
                  {estado.fase === "leyendo" ? `Leyendo ${estado.archivo}…` : "Elegir archivo"}
                </button>
              </div>
            </>
          )}

          {/* ---------------------------------------------------- 3: revisar */}
          {(estado.fase === "revisando" || estado.fase === "confirmar") && (
            <Revision
              estado={estado}
              modo={modo}
              modoTitulo={modoActual.titulo}
              onCambiar={reiniciar}
              onAplicar={() => aplicar(estado.archivo, estado.lectura)}
            />
          )}

          {/* ---------------------------------------------------- 4: aplicar */}
          {estado.fase === "subiendo" && (
            <section aria-labelledby="guardando" className="tarjeta px-5 py-5">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 id="guardando" className="flex items-center gap-2 text-[15px] font-semibold">
                  <Loader2 size={16} className="animate-spin" aria-hidden />
                  Guardando en la cartera
                </h2>
                <span className="cifras text-[13px] text-[var(--color-tinta-suave)]">
                  {cifra(estado.enviadas)} de {cifra(estado.total)} filas
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Avance de la carga"
                aria-valuenow={Math.round((estado.enviadas / estado.total) * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-relleno)]"
              >
                <div
                  className="h-full bg-[var(--color-ambar)] transition-[width] duration-200"
                  style={{ width: `${Math.round((estado.enviadas / estado.total) * 100)}%` }}
                />
              </div>
              <p className="mt-3 text-xs text-[var(--color-tinta-suave)]">
                No cierres esta página hasta que termine.
              </p>
            </section>
          )}

          {estado.fase === "listo" && (
            <section aria-labelledby="resultado" className="tarjeta px-5 py-5">
              <h2
                id="resultado"
                className="flex items-center gap-2 text-[15px] font-semibold text-[var(--color-exito)]"
              >
                <CheckCircle2 size={18} aria-hidden />
                {estado.modo === "actualizar"
                  ? "Actualización aplicada"
                  : estado.modo === "agregar"
                    ? "Puntos nuevos agregados"
                    : "Cartera actualizada"}
              </h2>
              <p className="mt-1 text-[13px] text-[var(--color-tinta-suave)]">{estado.archivo}</p>

              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-4">
                <div>
                  <dt className="text-[var(--color-tinta-suave)]">
                    {estado.modo === "actualizar" ? "Filas cambiadas" : "Filas guardadas"}
                  </dt>
                  <dd className="cifras text-xl font-semibold">{cifra(estado.guardadas)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-tinta-suave)]">Filas en el archivo</dt>
                  <dd className="cifras text-xl font-semibold">{cifra(estado.lectura.total)}</dd>
                </div>
                {estado.modo !== "reemplazar" && (
                  <div>
                    <dt className="text-[var(--color-tinta-suave)]">
                      {estado.modo === "agregar" ? "Ya existían" : "Sin coincidencia"}
                    </dt>
                    <dd className="cifras text-xl font-semibold">{cifra(estado.omitidas)}</dd>
                  </div>
                )}
                {estado.lectura.camposPresentes.includes("latitud") && (
                  <div>
                    <dt className="text-[var(--color-tinta-suave)]">Coords corregidas</dt>
                    <dd className="cifras text-xl font-semibold">{cifra(estado.lectura.coordsCorregidas)}</dd>
                  </div>
                )}
              </dl>

              {estado.avisoBitacora && (
                <p className="mt-4 flex items-start gap-2 rounded-[4px] bg-[var(--color-aviso-fondo)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-aviso-tinta)]">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
                  {estado.avisoBitacora}
                </p>
              )}

              {estado.noEncontradas.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-[13px] text-[var(--color-tinta-suave)]">
                    Ver ID que no existen en la cartera ({estado.noEncontradas.length}
                    {estado.noEncontradas.length === 50 ? "+" : ""})
                  </summary>
                  <p className="cifras mt-2 text-[12px] leading-relaxed text-[var(--color-tinta-suave)]">
                    {estado.noEncontradas.join(", ")}
                  </p>
                </details>
              )}

              {estado.lectura.descartadas.length > 0 && (
                <p className="mt-3 text-[13px]">
                  <button
                    type="button"
                    onClick={() => exportarObservaciones(estado.lectura.descartadas, estado.archivo)}
                    className="underline underline-offset-2"
                  >
                    {estado.lectura.descartadas.length === 1
                      ? "Descargar la fila con observaciones"
                      : `Descargar las ${cifra(estado.lectura.descartadas.length)} filas con observaciones`}
                  </button>
                </p>
              )}

              <div className="mt-5 flex flex-wrap gap-2.5 border-t border-[var(--color-linea)] pt-4">
                <button type="button" onClick={reiniciar} className="boton boton-primario">
                  <Upload size={16} aria-hidden />
                  Cargar otro archivo
                </button>
                <a href="#inicio" className="boton boton-secundario">
                  Ir al Inicio
                  <ArrowRight size={16} aria-hidden />
                </a>
              </div>
            </section>
          )}
        </div>

        {/* ---------------------------------------------------- columna derecha */}
        <aside className="space-y-4">
          {estado.fase === "confirmar" && estado.previa && (
            <section aria-labelledby="como-queda" className="tarjeta px-5 py-4">
              <h2 id="como-queda" className="text-[15px] font-semibold">
                Cómo va a quedar
              </h2>
              {modo === "actualizar" ? (
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
                  Se cambian <b className="cifras text-[var(--color-tinta)]">{cifra(estado.previa.existen)}</b>{" "}
                  puntos. La cartera queda con la misma cantidad.
                </p>
              ) : (
                <>
                  <div className="cifras mt-3 flex items-center gap-3">
                    <div>
                      <p className="text-xs text-[var(--color-tinta-suave)]">Hoy</p>
                      <p className="text-[22px] font-semibold">{cifra(hoyEnCiclos ?? totalHoy ?? 0)}</p>
                    </div>
                    <ArrowRight size={18} className="text-[var(--color-marcador)]" aria-hidden />
                    <div>
                      <p className="text-xs text-[var(--color-tinta-suave)]">Después</p>
                      <p className="text-[22px] font-semibold">
                        {cifra((hoyEnCiclos ?? totalHoy ?? 0) + estado.previa.nuevas)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-[var(--color-tinta-suave)]">
                    Puntos en {ciclosArchivo.length === 1 ? `el ciclo ${ciclosArchivo[0]}` : ciclosArchivo.length > 1 ? `los ciclos ${ciclosArchivo.join(", ")}` : "la cartera"}.
                  </p>
                </>
              )}
            </section>
          )}

          {estado.fase === "confirmar" && (
            <section aria-labelledby="revisado" className="tarjeta px-5 py-4">
              <h2 id="revisado" className="text-[15px] font-semibold">
                Lo que se revisó
              </h2>
              <ul className="mt-3 space-y-2.5 text-[13px]">
                {[
                  {
                    bien: estado.lectura.columnasIgnoradas.length === 0,
                    texto:
                      estado.lectura.columnasIgnoradas.length === 0
                        ? estado.lectura.camposPresentes.length === 1
                          ? "1 columna reconocida"
                          : `${estado.lectura.camposPresentes.length} columnas reconocidas`
                        : estado.lectura.columnasIgnoradas.length === 1
                          ? "1 columna no se reconoce y se ignora"
                          : `${estado.lectura.columnasIgnoradas.length} columnas no se reconocen y se ignoran`,
                  },
                  {
                    bien: estado.lectura.tieneCiclo && ciclosArchivo.length <= 1,
                    texto: !estado.lectura.tieneCiclo
                      ? "El archivo no trae columna CICLO"
                      : ciclosArchivo.length > 1
                        ? `El archivo trae ${ciclosArchivo.length} ciclos: ${ciclosArchivo.join(", ")}`
                        : `Un solo ciclo: ${ciclosArchivo[0] ?? "sin nombre"}`,
                  },
                  {
                    // Un archivo de actualización sin LATITUD ni LONGITUD no toca
                    // las coordenadas; uno que crea puntos sí las necesita.
                    bien: traeCoordenadas ? estado.lectura.sinCoordenadas === 0 : modo === "actualizar",
                    texto: !traeCoordenadas
                      ? modo === "actualizar"
                        ? "No cambia coordenadas"
                        : "El archivo no trae coordenadas: esos puntos no salen en el mapa"
                      : estado.lectura.sinCoordenadas === 0
                        ? "Todos los puntos traen coordenadas"
                        : estado.lectura.sinCoordenadas === 1
                          ? "1 punto sin coordenadas"
                          : `${cifra(estado.lectura.sinCoordenadas)} puntos sin coordenadas`,
                  },
                  {
                    bien: estado.lectura.descartadas.length === 0,
                    texto:
                      estado.lectura.descartadas.length === 0
                        ? "Ninguna fila con observaciones"
                        : estado.lectura.descartadas.length === 1
                          ? "1 fila con observaciones"
                          : `${cifra(estado.lectura.descartadas.length)} filas con observaciones`,
                  },
                ].map((c) => (
                  <li
                    key={c.texto}
                    className={`flex gap-2.5 ${c.bien ? "" : "text-[var(--color-aviso-tinta)]"}`}
                  >
                    {c.bien ? (
                      <Check size={16} className="mt-0.5 shrink-0 text-[var(--color-exito)]" aria-hidden />
                    ) : (
                      <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
                    )}
                    {c.texto}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {paso === 2 && (
            <section aria-labelledby="antes" className="tarjeta px-5 py-4">
              <h2 id="antes" className="text-[15px] font-semibold">
                Antes de cargar
              </h2>
              <ul className="mt-2.5 space-y-2 text-[13px] leading-snug text-[var(--color-tinta-suave)]">
                <li>
                  La plantilla vacía trae las {COLUMNAS_PLANTILLA.length} columnas en el orden que se
                  espera.
                </li>
                <li>
                  Si es la plantilla del ciclo, pon la consulta en{" "}
                  <a href="#mantenimiento" className="text-[var(--color-tinta)] underline underline-offset-2">
                    mantenimiento
                  </a>{" "}
                  mientras cargas y ábrela al terminar.
                </li>
                <li>En el paso 3 ves cuántos puntos son nuevos antes de guardar nada.</li>
              </ul>
            </section>
          )}

          {resumen?.ultimaCarga && (
            <section aria-labelledby="anterior" className="tarjeta px-5 py-4">
              <h2 id="anterior" className="text-[15px] font-semibold">
                {estado.fase === "listo" ? "Cargue anterior" : "Último cargue"}
              </h2>
              <p className="mt-2 text-[13px] break-all">{resumen.ultimaCarga.archivo}</p>
              <p className="mt-0.5 text-xs text-[var(--color-tinta-suave)] first-letter:uppercase">
                {cuando(resumen.ultimaCarga.created_at)}
                {resumen.ultimaCarga.cargado_por ? ` · ${resumen.ultimaCarga.cargado_por}` : ""}
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Paso 3: lo que va a pasar, para confirmar antes de guardar. */
function Revision({
  estado,
  modo,
  modoTitulo,
  onCambiar,
  onAplicar,
}: {
  estado: Extract<Estado, { fase: "revisando" | "confirmar" }>;
  modo: ModoCarga;
  modoTitulo: string;
  onCambiar: () => void;
  onAplicar: () => void;
}) {
  const { lectura, archivo } = estado;
  const previa = estado.fase === "confirmar" ? estado.previa : null;
  const revisando = estado.fase === "revisando";
  const sinId = lectura.total - lectura.filas.length;
  const bloqueado = modo === "reemplazar" && !lectura.tieneCiclo;

  const tiles =
    modo === "actualizar"
      ? [
          { nombre: "Se actualizan", valor: previa?.existen, tono: "neutro" },
          { nombre: "Sin coincidencia", valor: previa?.nuevas, tono: previa?.nuevas ? "aviso" : "neutro" },
        ]
      : modo === "agregar"
        ? [
            { nombre: "Se agregan", valor: previa?.nuevas, tono: "exito" },
            { nombre: "Ya existen, no se tocan", valor: previa?.existen, tono: "neutro" },
          ]
        : [
            { nombre: "Puntos nuevos", valor: previa?.nuevas, tono: "exito" },
            { nombre: "Se reescriben", valor: previa?.existen, tono: "neutro" },
          ];
  tiles.push({
    nombre: "Con observaciones",
    valor: lectura.descartadas.length,
    tono: lectura.descartadas.length > 0 ? "alerta" : "neutro",
  });

  const TONO: Record<string, string> = {
    exito: "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]",
    neutro: "bg-[var(--color-relleno)]",
    aviso: "bg-[var(--color-aviso-fondo)] text-[var(--color-aviso-tinta)]",
    alerta: "bg-[var(--color-alerta-fondo)] text-[var(--color-alerta)]",
  };

  return (
    <section aria-labelledby="revisar" className="tarjeta space-y-5 px-4 py-5 sm:px-6">
      <div>
        <h2 id="revisar" className="text-[18px] font-semibold">
          3 · Revisa antes de aplicar
        </h2>
        <p className="mt-1 text-[13px] text-[var(--color-tinta-suave)]">
          Nada cambia en la cartera hasta que toques el botón de abajo.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-[6px] bg-[var(--color-sutil)] px-3.5 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] border border-[var(--color-linea)] bg-[var(--color-papel)]">
          <FileSpreadsheet size={18} className="text-[var(--color-exito)]" aria-hidden />
        </span>
        <div className="min-w-0 flex-[1_1_220px]">
          <p className="truncate font-medium" title={archivo}>
            {archivo}
          </p>
          <p className="cifras text-xs text-[var(--color-tinta-suave)]">
            {cifra(lectura.total)} filas · {modoTitulo}
          </p>
        </div>
        <button type="button" onClick={onCambiar} className="boton boton-secundario boton-chico">
          Cambiar
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.nombre} className={`rounded-[6px] px-4 py-3 ${TONO[t.tono]}`}>
            <p className="text-[13px]">{t.nombre}</p>
            <p className="cifras mt-1 text-[24px] leading-tight font-semibold">
              {t.valor === undefined ? (
                revisando ? (
                  <Loader2 size={20} className="mt-1 animate-spin" aria-label="Contando" />
                ) : (
                  "—"
                )
              ) : (
                cifra(t.valor)
              )}
            </p>
          </div>
        ))}
      </div>

      {revisando && (
        <p className="cifras -mt-2 text-xs text-[var(--color-tinta-suave)]">
          Comparando con la cartera… {cifra(estado.revisadas)} de {cifra(lectura.filas.length)} filas
        </p>
      )}
      {estado.fase === "confirmar" && !previa && (
        <p className="-mt-2 text-xs text-[var(--color-tinta-suave)]">
          No se pudo comparar con la cartera; la carga funciona igual.
        </p>
      )}

      {modo === "actualizar" ? (
        <div>
          <p className="text-[13px] font-medium">Estas columnas se sobrescriben en los puntos que coincidan:</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {lectura.camposPresentes.map((c) => (
              <li key={c} className="rounded-full bg-[var(--color-relleno)] px-2.5 py-1 text-xs">
                {etiquetaDeCampo(c)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
            Las demás columnas de la base no se tocan. Ojo: una celda vacía sí cuenta como cambio y
            deja el campo en blanco.
          </p>
        </div>
      ) : (
        <details>
          <summary className="cursor-pointer text-[13px] text-[var(--color-tinta-suave)]">
            Ver las {lectura.camposPresentes.length} columnas reconocidas
          </summary>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {lectura.camposPresentes.map((c) => (
              <li key={c} className="rounded-full bg-[var(--color-relleno)] px-2.5 py-1 text-xs">
                {etiquetaDeCampo(c)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {!lectura.tieneCiclo && (
        <p className="rounded-[4px] bg-[var(--color-aviso-fondo)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-aviso-tinta)]">
          El archivo no trae columna CICLO.{" "}
          {modo === "reemplazar"
            ? "Este modo la necesita: elige actualizar, o agrega la columna al Excel."
            : "Cada ID se buscará en todos los ciclos, así que un PDV que exista en dos ciclos se cambiará en los dos."}
        </p>
      )}

      {lectura.columnasIgnoradas.length > 0 && (
        <p className="text-[13px] leading-snug text-[var(--color-tinta-suave)]">
          Se ignoran estas columnas porque no corresponden a ningún campo:{" "}
          {lectura.columnasIgnoradas.join(", ")}.
        </p>
      )}

      {lectura.descartadas.length > 0 && (
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[14px] font-semibold">Filas con observaciones</h3>
            <button
              type="button"
              onClick={() => exportarObservaciones(lectura.descartadas, archivo)}
              className="text-[13px] font-medium underline underline-offset-2"
            >
              {lectura.descartadas.length === 1
                ? "Descargar la fila en Excel"
                : `Descargar las ${cifra(lectura.descartadas.length)} en Excel`}
            </button>
          </div>
          <div className="overflow-x-auto rounded-[6px] border border-[var(--color-linea)]">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Fila</th>
                  <th scope="col">Qué pasa</th>
                </tr>
              </thead>
              <tbody className="cifras">
                {lectura.descartadas.slice(0, 5).map((d) => (
                  <tr key={d.fila}>
                    <td className="w-20">{cifra(d.fila)}</td>
                    <td>{d.motivo}</td>
                  </tr>
                ))}
                {lectura.descartadas.length > 5 && (
                  <tr>
                    <td colSpan={2} className="text-[var(--color-tinta-suave)]">
                      Y {cifra(lectura.descartadas.length - 5)} más en el Excel.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-linea)] pt-4">
        <button
          type="button"
          disabled={bloqueado || revisando}
          onClick={onAplicar}
          className="boton boton-primario"
        >
          {modo === "reemplazar"
            ? "Cargar la plantilla"
            : modo === "actualizar"
              ? `Actualizar ${cifra(lectura.filas.length)} filas`
              : "Agregar los puntos nuevos"}
        </button>
        <button type="button" onClick={onCambiar} className="boton boton-secundario">
          Cancelar
        </button>
        <span className="cifras text-[13px] text-[var(--color-tinta-suave)]">
          {sinId > 0
            ? `Se envían ${cifra(lectura.filas.length)} filas; ${cifra(sinId)} sin ID quedan por fuera.`
            : `Se envían las ${cifra(lectura.filas.length)} filas.`}
        </span>
      </div>
    </section>
  );
}
