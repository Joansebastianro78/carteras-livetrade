"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Image as Imagen,
  Loader2,
  LogOut,
  MapPin,
  Sheet,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import MapaCliente from "@/components/MapaCliente";
import ListaPuntos from "@/components/ListaPuntos";
import IlustracionRastreo from "@/components/IlustracionRastreo";
import { exportarCartera } from "@/lib/excel";
import { exportarCarteraImagen } from "@/lib/imagen";
import { colorDeRuta, numeroDeRuta, type RespuestaCartera } from "@/lib/tipos";

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
      await exportarCarteraImagen(datos.puntos, datos.consultor);
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
      const n = numeroDeRuta(p);
      if (n === null) continue;
      mapa.set(n, (mapa.get(n) ?? 0) + 1);
    }
    return [...mapa.entries()].sort((a, b) => a[0] - b[0]);
  }, [datos]);

  // ---------------------------------------------------------------- formulario
  if (!datos) {
    return (
      <main className="fondo-acceso flex-1 px-4 py-6 md:py-10">
        <div className="tarjeta-acceso mx-auto w-full max-w-4xl overflow-hidden rounded-[14px] border border-[var(--color-linea)] bg-[var(--color-papel)] md:grid md:grid-cols-[1.05fr_1fr]">
          {/* Panel de bienvenida. Se esconde en celular: en pantalla chica lo
              que importa es que el formulario quede de una, sin hacer scroll. */}
          <aside className="panel-acceso hidden flex-col justify-between p-8 text-white md:flex">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#9dc0cc]">
                <MapPin size={14} aria-hidden />
                Cartera LiveTrade
              </p>
              <h2 className="mt-3 text-[26px] leading-[1.15] font-semibold tracking-tight">
                Tus puntos del día, en el mapa
              </h2>
            </div>

            <IlustracionRastreo className="my-5 h-auto max-h-[34vh] w-full max-w-[290px] self-center" />

            <ul className="space-y-3 text-[14px] leading-snug text-[#d7e3e7]">
              <li className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-[#9fd3e2]"
                >
                  <MapPin size={15} />
                </span>
                Cada punto con su ruta, su dirección y qué hay que hacer allá.
              </li>
              <li className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-[#8fd6ab]"
                >
                  <Sheet size={15} />
                </span>
                Te la llevas en Excel o en imagen para el WhatsApp.
              </li>
              <li className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-[#f0c777]"
                >
                  <Smartphone size={15} />
                </span>
                Hecha para el celular y para trabajar en la calle.
              </li>
            </ul>
          </aside>

          <div className="p-6 sm:p-8">
            <p className="mb-5 flex items-center gap-2.5 md:hidden">
              <span
                aria-hidden
                className="grid h-9 w-9 place-items-center rounded-full bg-[#1F6F8B] text-white"
              >
                <MapPin size={18} />
              </span>
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-tinta-suave)]">
                Cartera LiveTrade
              </span>
            </p>

            <h1 className="text-[28px] leading-[1.1] font-semibold tracking-tight text-[var(--color-tinta)]">
              Tu cartera de hoy
            </h1>
            <p className="mt-2.5 text-[14px] leading-relaxed text-[var(--color-tinta-suave)]">
              Entra con tu usuario y tu contraseña Livetrade. Son los mismos con los
              que ingresas a la aplicación.
            </p>

            <form onSubmit={consultar} className="mt-6">
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
                    placeholder="BAV006"
                    value={usuario}
                    onChange={(e) => setUsuario(e.target.value.toUpperCase())}
                    className="campo cifras"
                  />
                </div>

                <div>
                  <label htmlFor="cedula" className="campo-etiqueta">
                    Contraseña Livetrade
                  </label>
                  <input
                    id="cedula"
                    name="cedula"
                    required
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Ba-BAV006"
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
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-[6px] bg-[#1F6F8B] px-4 py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-[#195b73] disabled:bg-[#9fb3bb] disabled:hover:bg-[#9fb3bb]"
              >
                {cargando && <Loader2 size={16} className="animate-spin" aria-hidden />}
                {cargando ? "Buscando tus puntos" : "Ver mi cartera"}
              </button>
            </form>

            <p className="mt-5 border-t border-[var(--color-linea)] pt-4 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
              ¿No te aparece tu cartera? Comunícate con Soporte BackOffice.
            </p>
          </div>
        </div>

        <p className="mt-6 flex items-center justify-center gap-3 text-center text-[13px] text-[var(--color-tinta-suave)]">
          <Link href="/backoffice" className="underline underline-offset-2">
            Acceso BackOffice
          </Link>
          <span aria-hidden>·</span>
          <Link href="/admin" className="underline underline-offset-2">
            Acceso administrador
          </Link>
        </p>
      </main>
    );
  }

  // ---------------------------------------------------------------- resultados
  return (
    <main className="flex-1">
      <header className="sticky top-0 z-20 border-b border-[var(--color-linea)] bg-[var(--color-papel)]">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold text-[var(--color-tinta)]">
              {datos.consultor.nombre ?? datos.consultor.usuario}
            </h1>
            <p className="cifras truncate text-xs text-[var(--color-tinta-suave)]">
              {datos.consultor.usuario}
              {datos.consultor.numDeRuta !== null && ` · ruta ${datos.consultor.numDeRuta}`}
              {` · ${datos.puntos.length} ${
                datos.puntos.length === 1 ? "punto" : "puntos"
              }`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => exportarCartera(datos.puntos, datos.consultor.usuario)}
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
