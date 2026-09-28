"use client";

import { useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import type { Tablero } from "@/lib/tableros";

export default function VisorTableros() {
  const [tableros, setTableros] = useState<Tablero[] | null>(null);
  const [elegido, setElegido] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pantallaCompleta, setPantallaCompleta] = useState(false);

  // Cambiar esta llave vuelve a montar el iframe: es la forma de recargar un
  // informe sin recargar toda la página.
  const [recarga, setRecarga] = useState(0);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const res = await fetch("/api/admin/tableros");
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(json.error ?? "No se pudo leer los tableros.");
      setTableros([]);
      return;
    }

    const lista = (json.tableros ?? []) as Tablero[];
    setTableros(lista);
    setElegido((actual) => actual || lista[0]?.id || "");
  }

  async function alternarPantallaCompleta() {
    if (!caja.current) return;

    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      setPantallaCompleta(false);
      return;
    }

    await caja.current.requestFullscreen?.().catch(() => {});
    setPantallaCompleta(Boolean(document.fullscreenElement));
  }

  if (tableros === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--color-tinta-suave)]">
        <Loader2 size={15} className="animate-spin" aria-hidden />
        Cargando tableros…
      </p>
    );
  }

  if (error) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-[4px] bg-[#f8ecea] px-3 py-2.5 text-[13px] text-[var(--color-alerta)]"
      >
        <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
        {error}
      </p>
    );
  }

  if (tableros.length === 0) {
    return (
      <p className="rounded-[4px] border border-dashed border-[var(--color-linea)] px-4 py-8 text-center text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
        Todavía no hay tableros publicados. Un administrador los agrega desde su
        panel, en la pestaña Tableros.
      </p>
    );
  }

  const actual = tableros.find((t) => t.id === elegido) ?? tableros[0];

  return (
    <div className="space-y-4">
      <section>
        <h2 className="text-sm font-semibold">Tableros de Power BI</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
          Se abren con tu propia cuenta de Power BI. Si un informe te pide
          iniciar sesión o dice que no tienes acceso, el permiso se pide allá,
          no aquí.
        </p>
      </section>

      {tableros.length > 1 && (
        <div>
          <label htmlFor="tablero" className="campo-etiqueta">
            Cuál ver
          </label>
          <select
            id="tablero"
            value={actual.id}
            onChange={(e) => setElegido(e.target.value)}
            className="campo"
          >
            {tableros.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
                {t.activo ? "" : " (sin publicar)"}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="min-w-[12rem] flex-1">
            <span className="block text-sm font-medium">{actual.nombre}</span>
            {actual.descripcion && (
              <span className="mt-0.5 block text-xs leading-snug text-[var(--color-tinta-suave)]">
                {actual.descripcion}
              </span>
            )}
          </span>

          <span className="flex items-center gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={() => setRecarga((n) => n + 1)}
              title="Volver a cargar el informe"
              className="flex items-center gap-1.5 rounded-[4px] border border-[var(--color-linea)] px-3 py-1.5 text-xs"
            >
              <RefreshCw size={13} aria-hidden />
              Recargar
            </button>

            <button
              type="button"
              onClick={alternarPantallaCompleta}
              className="flex items-center gap-1.5 rounded-[4px] border border-[var(--color-linea)] px-3 py-1.5 text-xs"
            >
              {pantallaCompleta ? (
                <Minimize2 size={13} aria-hidden />
              ) : (
                <Maximize2 size={13} aria-hidden />
              )}
              Pantalla completa
            </button>

            <a
              href={actual.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-[4px] border border-[var(--color-linea)] px-3 py-1.5 text-xs"
            >
              <ExternalLink size={13} aria-hidden />
              Abrir en Power BI
            </a>
          </span>
        </div>

        {/* El informe manda su propio alto, así que se le da una proporción
            cómoda en pantalla grande y una altura fija en celular, donde 16:9
            deja el tablero ilegible. */}
        <div
          ref={caja}
          className="mt-3 overflow-hidden rounded-[6px] border border-[var(--color-linea)] bg-[var(--color-papel)]"
        >
          <iframe
            key={`${actual.id}-${recarga}`}
            title={actual.nombre}
            src={actual.url}
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="h-[70vh] w-full border-0 sm:aspect-[16/10] sm:h-auto"
          />
        </div>

        <p className="mt-2 text-xs leading-relaxed text-[var(--color-tinta-suave)]">
          En celular el informe se ve mejor en horizontal, o con el botón Abrir
          en Power BI.
        </p>
      </div>
    </div>
  );
}
