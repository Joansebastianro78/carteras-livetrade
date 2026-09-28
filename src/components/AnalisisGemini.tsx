"use client";

import { useRef, useState } from "react";
import {
  Copy,
  Check,
  ImageUp,
  Loader2,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";

/**
 * Análisis del tablero con Gemini.
 *
 * Power BI se muestra en un iframe de otro dominio, así que el navegador no
 * nos deja leer nada de adentro: ni el texto ni una captura automática. Por
 * eso el flujo es manual a propósito — la persona pega la captura (Ctrl+V
 * después de Win+Shift+S) o pega los datos exportados, y eso es lo que viaja
 * a Gemini.
 */

const ANCHO_MAXIMO = 1600;

/** Reduce la captura antes de mandarla: menos espera y menos costo. */
async function encoger(archivo: File): Promise<string> {
  const original = await new Promise<HTMLImageElement>((listo, falla) => {
    const img = new Image();
    img.onload = () => listo(img);
    img.onerror = () => falla(new Error("No se pudo leer la imagen"));
    img.src = URL.createObjectURL(archivo);
  });

  const escala = Math.min(1, ANCHO_MAXIMO / original.width);
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(original.width * escala);
  lienzo.height = Math.round(original.height * escala);

  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");

  ctx.drawImage(original, 0, 0, lienzo.width, lienzo.height);
  URL.revokeObjectURL(original.src);

  return lienzo.toDataURL("image/jpeg", 0.85);
}

export default function AnalisisGemini({ tablero }: { tablero: string }) {
  const [imagen, setImagen] = useState<string | null>(null);
  const [datos, setDatos] = useState("");
  const [pregunta, setPregunta] = useState("");

  const [analizando, setAnalizando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const archivoRef = useRef<HTMLInputElement>(null);

  async function tomarArchivo(archivo: File | null | undefined) {
    if (!archivo) return;
    setError(null);

    try {
      setImagen(await encoger(archivo));
    } catch {
      setError("No se pudo leer esa imagen. Prueba con un PNG o un JPG.");
    }
  }

  function alPegar(e: React.ClipboardEvent) {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
    if (item) {
      e.preventDefault();
      tomarArchivo(item.getAsFile());
    }
  }

  async function analizar() {
    setAnalizando(true);
    setError(null);
    setResultado(null);

    const res = await fetch("/api/admin/analisis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagen, datos, pregunta, tablero }),
    });
    const json = await res.json().catch(() => ({}));
    setAnalizando(false);

    if (!res.ok) {
      setError(json.error ?? "No se pudo analizar.");
      return;
    }
    setResultado(json.texto);
  }

  async function copiar() {
    if (!resultado) return;
    await navigator.clipboard.writeText(resultado).catch(() => {});
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <section className="rounded-[6px] border border-[var(--color-linea)] bg-[var(--color-papel)] p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-tinta)]">
        <Sparkles size={16} className="text-[#7a5410]" aria-hidden />
        Analizar este tablero con Gemini
      </h3>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
        Toma una captura del tablero y pégala aquí con Ctrl+V, o pega los datos
        que exportaste de una visualización. Power BI corre en un marco aparte,
        así que la página no puede leerlo sola.
      </p>

      {/* ------------------------------------------------------ captura */}
      <div
        onPaste={alPegar}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          tomarArchivo(e.dataTransfer.files?.[0]);
        }}
        tabIndex={0}
        className="mt-4 rounded-[4px] border border-dashed border-[var(--color-linea)] p-4 text-center focus:border-[var(--color-tinta)] focus:outline-none"
      >
        {imagen ? (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imagen}
              alt="Captura del tablero que se va a analizar"
              className="mx-auto max-h-56 w-auto rounded-[3px] border border-[var(--color-linea)]"
            />
            <button
              type="button"
              onClick={() => setImagen(null)}
              className="inline-flex items-center gap-1.5 text-xs text-[var(--color-tinta-suave)] hover:text-[var(--color-tinta)]"
            >
              <X size={13} aria-hidden />
              Quitar la captura
            </button>
          </div>
        ) : (
          <>
            <ImageUp
              size={20}
              className="mx-auto text-[var(--color-tinta-suave)]"
              aria-hidden
            />
            <p className="mt-2 text-[13px] text-[var(--color-tinta-suave)]">
              Haz clic aquí y pega la captura con Ctrl+V, o arrástrala
            </p>
            <button
              type="button"
              onClick={() => archivoRef.current?.click()}
              className="mt-2 rounded-[4px] border border-[var(--color-linea)] px-3 py-1.5 text-xs"
            >
              Elegir imagen
            </button>
          </>
        )}

        <input
          ref={archivoRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => tomarArchivo(e.target.files?.[0])}
        />
      </div>

      {/* ------------------------------------------------------ datos */}
      <div className="mt-4">
        <label htmlFor="datos-tablero" className="campo-etiqueta">
          O pega los datos (opcional)
        </label>
        <textarea
          id="datos-tablero"
          rows={3}
          value={datos}
          onChange={(e) => setDatos(e.target.value)}
          placeholder="Pega aquí una tabla del tablero o lo que exportaste a Excel"
          className="campo resize-y"
        />
      </div>

      {/* ------------------------------------------------------ pregunta */}
      <div className="mt-4">
        <label htmlFor="pregunta-tablero" className="campo-etiqueta">
          Pregunta concreta (opcional)
        </label>
        <input
          id="pregunta-tablero"
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          placeholder="¿Por qué cayó la efectividad esta semana?"
          className="campo"
        />
      </div>

      <button
        type="button"
        onClick={analizar}
        disabled={analizando || (!imagen && !datos.trim())}
        className="mt-4 flex items-center gap-2 rounded-[4px] bg-[#1F6F8B] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#195b73] disabled:bg-[#9fb3bb]"
      >
        {analizando ? (
          <Loader2 size={15} className="animate-spin" aria-hidden />
        ) : (
          <Sparkles size={15} aria-hidden />
        )}
        {analizando ? "Analizando" : "Analizar"}
      </button>

      {error && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-[4px] bg-[#f8ecea] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-alerta)]"
        >
          <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {resultado && (
        <div className="mt-4 rounded-[4px] border border-[var(--color-linea)] bg-[#f7f9f7] p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-tinta-suave)]">
              Análisis
            </p>
            <button
              type="button"
              onClick={copiar}
              className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-tinta-suave)] hover:text-[var(--color-tinta)]"
            >
              {copiado ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
              {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>

          <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-[var(--color-tinta)]">
            {resultado.split("\n").map((linea, i) =>
              linea.trim() === "" ? null : (
                <p key={i}>
                  {/* El modelo marca los títulos con **negrilla**. */}
                  {linea.split(/(\*\*[^*]+\*\*)/g).map((trozo, j) =>
                    trozo.startsWith("**") && trozo.endsWith("**") ? (
                      <strong key={j} className="font-semibold">
                        {trozo.slice(2, -2)}
                      </strong>
                    ) : (
                      <span key={j}>{trozo}</span>
                    )
                  )}
                </p>
              )
            )}
          </div>

          <p className="mt-3 border-t border-[var(--color-linea)] pt-2 text-xs leading-snug text-[var(--color-tinta-suave)]">
            Lo escribió un modelo a partir de lo que le mandaste. Verifica las
            cifras contra el tablero antes de pasarlas a un informe.
          </p>
        </div>
      )}
    </section>
  );
}
