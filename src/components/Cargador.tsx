"use client";

import { useRef, useState } from "react";
import {
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
  leerPlantilla,
  type ModoCarga,
  type ResultadoLectura,
} from "@/lib/excel";

const TAM_LOTE = 500;

const MODOS: { id: ModoCarga; titulo: string; detalle: string }[] = [
  {
    id: "reemplazar",
    titulo: "Cargar la plantilla completa",
    detalle:
      "Para el archivo maestro del ciclo. Crea los puntos nuevos y reescribe por completo los que ya existan. Requiere columna CICLO.",
  },
  {
    id: "actualizar",
    titulo: "Actualizar solo lo que traiga el archivo",
    detalle:
      "Para correcciones masivas: reasignar vendedores, arreglar direcciones, mover coordenadas. Solo toca las columnas presentes en el Excel y no crea puntos nuevos.",
  },
  {
    id: "agregar",
    titulo: "Agregar únicamente los puntos nuevos",
    detalle:
      "Inserta lo que no exista y deja intacto lo que ya está en la cartera.",
  },
];

type Estado =
  | { fase: "reposo" }
  | { fase: "leyendo"; archivo: string }
  | { fase: "confirmar"; archivo: string; lectura: ResultadoLectura; datos: ArrayBuffer }
  | { fase: "subiendo"; archivo: string; enviadas: number; total: number }
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

export default function Cargador() {
  const [modo, setModo] = useState<ModoCarga>("reemplazar");
  const [estado, setEstado] = useState<Estado>({ fase: "reposo" });
  const [arrastrando, setArrastrando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function leer(archivo: File) {
    setEstado({ fase: "leyendo", archivo: archivo.name });

    try {
      const datos = await archivo.arrayBuffer();
      const lectura = leerPlantilla(datos);

      if (lectura.filas.length === 0) {
        setEstado({
          fase: "error",
          mensaje:
            "El archivo no tiene filas con columna ID. Revisa que sea la plantilla correcta.",
        });
        return;
      }

      setEstado({ fase: "confirmar", archivo: archivo.name, lectura, datos });
    } catch (e) {
      setEstado({
        fase: "error",
        mensaje:
          e instanceof Error
            ? e.message
            : "No pudimos leer el archivo. Verifica que sea .xlsx y no esté protegido con contraseña.",
      });
    }
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

      setEstado({ fase: "subiendo", archivo, enviadas: i, total });

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
          mensaje: `Se procesaron ${guardadas} de ${total} filas y el proceso se detuvo. ${
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

    setEstado({
      fase: "listo",
      archivo,
      modo,
      guardadas,
      omitidas,
      noEncontradas,
      avisoBitacora,
      lectura,
    });
  }

  function alSoltar(e: React.DragEvent) {
    e.preventDefault();
    setArrastrando(false);
    const archivo = e.dataTransfer.files?.[0];
    if (archivo) leer(archivo);
  }

  const ocupado = estado.fase === "leyendo" || estado.fase === "subiendo";
  const porcentaje =
    estado.fase === "subiendo" ? Math.round((estado.enviadas / estado.total) * 100) : 0;

  return (
    <section>
      {/* ------------------------------------------------------------- modo */}
      <fieldset className="rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)] p-5">
        <legend className="px-1 text-sm font-semibold">Qué quieres hacer</legend>

        <div className="mt-2 space-y-3">
          {MODOS.map((m) => (
            <label
              key={m.id}
              className={`flex cursor-pointer gap-3 rounded-[4px] border p-3 ${
                modo === m.id
                  ? "border-[var(--color-tinta)] bg-[#f3f6f3]"
                  : "border-[var(--color-linea)]"
              }`}
            >
              <input
                type="radio"
                name="modo"
                value={m.id}
                checked={modo === m.id}
                disabled={ocupado}
                onChange={() => {
                  setModo(m.id);
                  setEstado({ fase: "reposo" });
                }}
                className="mt-1 shrink-0"
              />
              <span>
                <span className="block text-sm font-medium">{m.titulo}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-[var(--color-tinta-suave)]">
                  {m.detalle}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* ---------------------------------------------------------- archivo */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={alSoltar}
        className={`mt-5 rounded-[4px] border-2 border-dashed px-6 py-10 text-center ${
          arrastrando
            ? "border-[var(--color-tinta)] bg-[#e4e9e6]"
            : "border-[var(--color-linea)] bg-[var(--color-papel)]"
        }`}
      >
        <FileSpreadsheet
          size={28}
          className="mx-auto text-[var(--color-tinta-suave)]"
          aria-hidden
        />
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
          onChange={(e) => {
            const archivo = e.target.files?.[0];
            if (archivo) leer(archivo);
            e.target.value = "";
          }}
        />

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={ocupado}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-[4px] bg-[var(--color-tinta)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-45"
          >
            <Upload size={15} aria-hidden />
            Elegir archivo
          </button>

          <button
            type="button"
            onClick={descargarPlantillaVacia}
            title={`Excel vacío con las ${COLUMNAS_PLANTILLA.length} columnas en orden`}
            className="inline-flex items-center gap-2 rounded-[4px] border border-[var(--color-linea)] bg-white px-4 py-2.5 text-sm text-[var(--color-tinta)] hover:border-[var(--color-tinta)]"
          >
            <Download size={15} aria-hidden />
            Descargar plantilla vacía
          </button>
        </div>
      </div>

      {estado.fase === "leyendo" && (
        <p className="mt-4 flex items-center gap-2 text-sm text-[var(--color-tinta-suave)]">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          Leyendo {estado.archivo}…
        </p>
      )}

      {/* ------------------------------------------------------- confirmar */}
      {estado.fase === "confirmar" && (
        <div className="mt-4 rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)] p-5">
          <h3 className="text-sm font-semibold">Revisa antes de aplicar</h3>
          <p className="cifras mt-1 text-[13px] text-[var(--color-tinta-suave)]">
            {estado.archivo} · {estado.lectura.filas.length} filas
          </p>

          <p className="mt-4 text-[13px] font-medium">
            {modo === "actualizar"
              ? "Estas columnas se sobrescriben en los puntos que coincidan:"
              : "Columnas reconocidas en el archivo:"}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {estado.lectura.camposPresentes.map((c) => (
              <li
                key={c}
                className="rounded-full bg-[#eceeeb] px-2.5 py-1 text-xs text-[var(--color-tinta)]"
              >
                {etiquetaDeCampo(c)}
              </li>
            ))}
          </ul>

          {modo === "actualizar" && (
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
              Las demás columnas de la base no se tocan. Ojo: una celda vacía sí
              cuenta como cambio y deja el campo en blanco.
            </p>
          )}

          {!estado.lectura.tieneCiclo && (
            <p className="mt-3 rounded-[4px] bg-[#fdf4e3] px-3 py-2.5 text-[13px] leading-snug text-[#7a5410]">
              El archivo no trae columna CICLO.{" "}
              {modo === "reemplazar"
                ? "Este modo la necesita: elige actualizar, o agrega la columna al Excel."
                : "Cada ID se buscará en todos los ciclos, así que un PDV que exista en dos ciclos se cambiará en los dos."}
            </p>
          )}

          {estado.lectura.columnasIgnoradas.length > 0 && (
            <p className="mt-3 text-[13px] leading-snug text-[var(--color-tinta-suave)]">
              Se ignoran estas columnas porque no corresponden a ningún campo:{" "}
              {estado.lectura.columnasIgnoradas.join(", ")}.
            </p>
          )}

          {estado.lectura.descartadas.length > 0 && (
            <p className="mt-3 text-[13px] text-[var(--color-tinta-suave)]">
              {estado.lectura.descartadas.length} fila(s) con observaciones; se
              detallan al terminar.
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={modo === "reemplazar" && !estado.lectura.tieneCiclo}
              onClick={() => aplicar(estado.archivo, estado.lectura)}
              className="rounded-[4px] bg-[var(--color-tinta)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-45"
            >
              {modo === "reemplazar"
                ? "Cargar la plantilla"
                : modo === "actualizar"
                  ? `Actualizar ${estado.lectura.filas.length} filas`
                  : "Agregar los puntos nuevos"}
            </button>
            <button
              type="button"
              onClick={() => setEstado({ fase: "reposo" })}
              className="rounded-[4px] border border-[var(--color-linea)] px-4 py-2.5 text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------- progreso */}
      {estado.fase === "subiendo" && (
        <div className="mt-4">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span>Guardando en Supabase</span>
            <span className="cifras text-[var(--color-tinta-suave)]">
              {estado.enviadas} de {estado.total}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={porcentaje}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-linea)]"
          >
            <div
              className="h-full bg-[var(--color-ambar)] transition-[width] duration-200"
              style={{ width: `${porcentaje}%` }}
            />
          </div>
        </div>
      )}

      {estado.fase === "error" && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-[4px] bg-[#f8ecea] px-3 py-3 text-[13px] leading-snug text-[var(--color-alerta)]"
        >
          <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
          {estado.mensaje}
        </p>
      )}

      {/* ---------------------------------------------------------- resumen */}
      {estado.fase === "listo" && (
        <div className="mt-4 rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)] p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-[var(--color-exito)]">
            <CheckCircle2 size={16} aria-hidden />
            {estado.modo === "actualizar"
              ? "Actualización aplicada"
              : estado.modo === "agregar"
                ? "Puntos nuevos agregados"
                : "Cartera actualizada"}
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
            <div>
              <dt className="text-[var(--color-tinta-suave)]">
                {estado.modo === "actualizar" ? "Filas cambiadas" : "Filas guardadas"}
              </dt>
              <dd className="cifras text-lg font-medium">{estado.guardadas}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-tinta-suave)]">Filas en el archivo</dt>
              <dd className="cifras text-lg font-medium">{estado.lectura.total}</dd>
            </div>
            {estado.modo !== "reemplazar" && (
              <div>
                <dt className="text-[var(--color-tinta-suave)]">
                  {estado.modo === "agregar" ? "Ya existían" : "Sin coincidencia"}
                </dt>
                <dd className="cifras text-lg font-medium">{estado.omitidas}</dd>
              </div>
            )}
            {estado.lectura.camposPresentes.includes("latitud") && (
              <div>
                <dt className="text-[var(--color-tinta-suave)]">Coords corregidas</dt>
                <dd className="cifras text-lg font-medium">
                  {estado.lectura.coordsCorregidas}
                </dd>
              </div>
            )}
          </dl>

          {estado.avisoBitacora && (
            <p className="mt-4 flex items-start gap-2 rounded-[4px] bg-[#fdf4e3] px-3 py-2.5 text-[13px] leading-snug text-[#7a5410]">
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
            <details className="mt-3">
              <summary className="cursor-pointer text-[13px] text-[var(--color-tinta-suave)]">
                Ver {estado.lectura.descartadas.length} fila(s) con observaciones
              </summary>
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-[12px] text-[var(--color-tinta-suave)]">
                {estado.lectura.descartadas.map((d, i) => (
                  <li key={i} className="cifras">
                    Fila {d.fila}: {d.motivo}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
} 