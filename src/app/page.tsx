"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Image as Imagen, Loader2, LogOut, Sheet, TriangleAlert } from "lucide-react";
import MapaCliente from "@/components/MapaCliente";
import ListaPuntos from "@/components/ListaPuntos";
import { exportarCartera } from "@/lib/excel";
import { exportarCarteraImagen } from "@/lib/imagen";
import { colorDeRuta, type RespuestaCartera } from "@/lib/tipos";

export default function Consulta() {
  const [usuario, setUsuario] = useState("");
  const [cedula, setCedula] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [datos, setDatos] = useState<RespuestaCartera | null>(null);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [generandoImagen, setGenerandoImagen] = useState(false);

  async function consultar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    setSeleccionado(null);

    try {
      const res = await fetch("/api/cartera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, cedula }),
      });
      const json = await res.json();
      if (!res.ok) {
        setDatos(null);
        setError(json.error ?? "No pudimos completar la consulta.");
        return;
      }
      setDatos(json as RespuestaCartera);
    } catch {
      setDatos(null);
      setError("No hay conexión con el servidor. Revisa tus datos móviles.");
    } finally {
      setCargando(false);
    }
  }

  async function descargarImagen() {
    if (!datos) return;
    setGenerandoImagen(true);
    setError(null);
    try {
      await exportarCarteraImagen(datos.puntos, datos.vendedor);
    } catch {
      setError("No se pudo crear la imagen. Descarga el Excel mientras tanto.");
    } finally {
      setGenerandoImagen(false);
    }
  }

  function salir() {
    setDatos(null);
    setError(null);
    setCedula("");
    setSeleccionado(null);
  }

  const rutas = useMemo(() => {
    if (!datos) return [];
    const mapa = new Map<number, number>();
    for (const p of datos.puntos) {
      if (p.ruta === null) continue;
      mapa.set(p.ruta, (mapa.get(p.ruta) ?? 0) + 1);
    }
    return [...mapa.entries()].sort((a, b) => a[0] - b[0]);
  }, [datos]);

  // ---------------------------------------------------------------- formulario
  if (!datos) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
        <header className="mb-8">
          <h1 className="text-[32px] leading-[1.1] font-semibold tracking-tight text-[var(--color-tinta)]">
            Tu cartera de hoy
          </h1>
          <p className="mt-3 max-w-[46ch] text-[15px] leading-relaxed text-[var(--color-tinta-suave)]">
            Entra con tu usuario y tu cédula para ver en el mapa los puntos que
            tienes asignados y descargar la lista en Excel.
          </p>
        </header>

        <form
          onSubmit={consultar}
          className="rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)] p-5"
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="usuario" className="campo-etiqueta">
                Usuario
              </label>
              <input
                id="usuario"
                name="usuario"
                required
                autoComplete="username"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="BAV172"
                value={usuario}
                onChange={(e) => setUsuario(e.target.value.toUpperCase())}
                className="campo cifras"
              />
            </div>

            <div>
              <label htmlFor="cedula" className="campo-etiqueta">
                Cédula
              </label>
              <input
                id="cedula"
                name="cedula"
                required
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="70816763"
                value={cedula}
                onChange={(e) => setCedula(e.target.value)}
                className="campo cifras"
              />
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-[4px] bg-[#f8ecea] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-alerta)]"
            >
              <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={cargando || !usuario || !cedula}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-[4px] bg-[var(--color-tinta)] px-4 py-3 text-[15px] font-medium text-white disabled:opacity-45"
          >
            {cargando && <Loader2 size={16} className="animate-spin" aria-hidden />}
            {cargando ? "Buscando tus puntos" : "Ver mi cartera"}
          </button>
        </form>

        <p className="mt-6 text-center text-[13px] text-[var(--color-tinta-suave)]">
          <Link href="/admin" className="underline underline-offset-2">
            Acceso administrador
          </Link>
        </p>
      </main>
    );
  }

  // ---------------------------------------------------------------- resultados
  return (
    <main className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-[var(--color-linea)] bg-[var(--color-papel)]">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold text-[var(--color-tinta)]">
              {datos.vendedor.nombre ?? datos.vendedor.usuario}
            </h1>
            <p className="cifras truncate text-xs text-[var(--color-tinta-suave)]">
              {datos.vendedor.usuario}
              {datos.vendedor.numDeRuta !== null && ` · ruta ${datos.vendedor.numDeRuta}`}
              {` · ${datos.puntos.length} ${
                datos.puntos.length === 1 ? "punto" : "puntos"
              }`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => exportarCartera(datos.puntos, datos.vendedor.usuario)}
            className="flex items-center gap-2 rounded-[4px] bg-[var(--color-ambar)] px-3 py-2 text-[13px] font-medium text-white hover:bg-[var(--color-ambar-oscuro)]"
          >
            <Sheet size={15} aria-hidden />
            <span className="hidden sm:inline">Descargar en Excel</span>
            <span className="sm:hidden">Excel</span>
          </button>

          <button
            type="button"
            onClick={descargarImagen}
            disabled={generandoImagen}
            className="flex items-center gap-2 rounded-[4px] border border-[var(--color-linea)] px-3 py-2 text-[13px] font-medium text-[var(--color-tinta)] disabled:opacity-45"
          >
            {generandoImagen ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <Imagen size={15} aria-hidden />
            )}
            <span className="hidden sm:inline">
              {generandoImagen ? "Creando imagen" : "Descargar en imagen"}
            </span>
            <span className="sm:hidden">Imagen</span>
          </button>

          <button
            type="button"
            onClick={salir}
            aria-label="Salir y consultar otro usuario"
            className="rounded-[4px] border border-[var(--color-linea)] p-2 text-[var(--color-tinta-suave)] hover:text-[var(--color-tinta)]"
          >
            <LogOut size={15} aria-hidden />
          </button>
        </div>

        {rutas.length > 0 && (
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--color-linea)] px-4 py-2">
            {rutas.map(([ruta, n]) => (
              <span
                key={ruta}
                className="flex items-center gap-1.5 text-xs text-[var(--color-tinta-suave)]"
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: colorDeRuta(ruta) }}
                />
                <span className="cifras">
                  Ruta {ruta} · {n}
                </span>
              </span>
            ))}
          </div>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="mx-auto flex max-w-[1400px] items-center gap-2 bg-[#f8ecea] px-4 py-2.5 text-[13px] text-[var(--color-alerta)]"
        >
          <TriangleAlert size={14} className="shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {datos.sinCoordenadas > 0 && (
        <p className="mx-auto flex max-w-[1400px] items-center gap-2 bg-[#fdf4e3] px-4 py-2.5 text-[13px] text-[#7a5410]">
          <TriangleAlert size={14} className="shrink-0" aria-hidden />
          {datos.sinCoordenadas === 1
            ? "1 punto no tiene ubicación válida y no aparece en el mapa. Búscalo en la lista."
            : `${datos.sinCoordenadas} puntos no tienen ubicación válida y no aparecen en el mapa. Búscalos en la lista.`}
        </p>
      )}

      <div className="mx-auto grid max-w-[1400px] gap-0 lg:grid-cols-[1fr_400px]">
        <div className="h-[52vh] border-b border-[var(--color-linea)] lg:sticky lg:top-[57px] lg:h-[calc(100dvh-57px)] lg:border-b-0 lg:border-r">
          <MapaCliente
            puntos={datos.puntos}
            seleccionado={seleccionado}
            onSeleccionar={setSeleccionado}
          />
        </div>

        <div className="bg-[var(--color-papel)]">
          <ListaPuntos
            puntos={datos.puntos}
            seleccionado={seleccionado}
            onSeleccionar={setSeleccionado}
          />
        </div>
      </div>
    </main>
  );
}
