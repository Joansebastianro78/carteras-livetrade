"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Image as Imagen,
  Loader2,
  MapPin,
  Search,
  Sheet,
  TriangleAlert,
  User,
} from "lucide-react";
import MapaCliente from "./MapaCliente";
import ListaPuntos from "./ListaPuntos";
import { exportarCartera } from "@/lib/excel";
import { exportarCarteraImagen } from "@/lib/imagen";
import { colorDeRuta, numeroDeRuta, type PuntoCartera } from "@/lib/tipos";

type Consultor = {
  usuario: string;
  ccuser: string;
  nom: string | null;
  num_de_ruta: number | null;
  puntos: number;
  ciclos: number;
  ciclo_reciente: string | null;
  sin_ubicacion: number;
  ultima_actualizacion: string | null;
};

type Detalle = {
  puntos: PuntoCartera[];
  consultor: {
    usuario: string;
    nombre: string | null;
    numDeRuta: number | null;
    ccuser: string;
  };
  sinCoordenadas: number;
};

export default function BackOffice() {
  const [q, setQ] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [consultores, setConsultores] = useState<Consultor[] | null>(null);

  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const [cicloElegido, setCicloElegido] = useState("");
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [generandoImagen, setGenerandoImagen] = useState(false);

  const [error, setError] = useState<string | null>(null);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    setBuscando(true);
    setError(null);
    setDetalle(null);

    const res = await fetch(`/api/admin/consultores?q=${encodeURIComponent(q)}`);
    const json = await res.json().catch(() => ({}));
    setBuscando(false);

    if (!res.ok) {
      setConsultores(null);
      setError(json.error ?? "Falló la búsqueda.");
      return;
    }
    setConsultores(json.consultores ?? []);
  }

  async function abrir(v: Consultor) {
    setAbriendo(`${v.usuario}|${v.ccuser}`);
    setError(null);

    const res = await fetch(
      `/api/admin/consultores?usuario=${encodeURIComponent(
        v.usuario
      )}&ccuser=${encodeURIComponent(v.ccuser)}`
    );
    const json = await res.json().catch(() => ({}));
    setAbriendo(null);

    if (!res.ok) {
      setError(json.error ?? "No se pudo abrir la cartera.");
      return;
    }

    setDetalle(json as Detalle);
    setSeleccionado(null);

    // Siempre abre con todo lo que tiene asignado el consultor. El filtro por
    // ciclo queda ahí para quien lo necesite, pero nadie debería tener que
    // acordarse de cambiarlo para ver la cartera completa.
    setCicloElegido("");
  }

  // Un consultor puede tener puntos de varios ciclos a la vez. El filtro deja
  // ver solo el que interesa sin volver a consultar la base.
  const ciclos = useMemo(() => {
    if (!detalle) return [];
    return [...new Set(detalle.puntos.map((p) => p.ciclo))].sort();
  }, [detalle]);

  const puntos = useMemo(() => {
    if (!detalle) return [];
    return cicloElegido
      ? detalle.puntos.filter((p) => p.ciclo === cicloElegido)
      : detalle.puntos;
  }, [detalle, cicloElegido]);

  const rutas = useMemo(() => {
    const mapa = new Map<number, number>();
    for (const p of puntos) {
      const n = numeroDeRuta(p);
      if (n === null) continue;
      mapa.set(n, (mapa.get(n) ?? 0) + 1);
    }
    return [...mapa.entries()].sort((a, b) => a[0] - b[0]);
  }, [puntos]);

  const sinUbicacion = puntos.filter((p) => p.latitud === null).length;

  async function descargarImagen() {
    if (!detalle) return;
    setGenerandoImagen(true);
    setError(null);
    try {
      await exportarCarteraImagen(puntos, {
        usuario: detalle.consultor.usuario,
        nombre: detalle.consultor.nombre,
      });
    } catch {
      setError("No se pudo crear la imagen. Descarga el Excel mientras tanto.");
    } finally {
      setGenerandoImagen(false);
    }
  }

  // ------------------------------------------------------------- detalle
  if (detalle) {
    const v = detalle.consultor;

    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setDetalle(null)}
          className="flex items-center gap-1.5 text-[13px] text-[var(--color-tinta-suave)] hover:text-[var(--color-tinta)]"
        >
          <ArrowLeft size={14} aria-hidden />
          Volver a la búsqueda
        </button>

        <section className="rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)] p-5">
          <h2 className="text-[15px] font-semibold text-[var(--color-tinta)]">
            {v.nombre ?? v.usuario}
          </h2>
          <p className="cifras mt-1 text-xs text-[var(--color-tinta-suave)]">
            {v.usuario} · cc {v.ccuser}
            {v.numDeRuta !== null && ` · ruta ${v.numDeRuta}`} ·{" "}
            {puntos.length} {puntos.length === 1 ? "punto" : "puntos"}
          </p>

          {ciclos.length > 1 && (
            <div className="mt-4">
              <label htmlFor="ciclo-backoffice" className="campo-etiqueta">
                Ciclo
              </label>
              <select
                id="ciclo-backoffice"
                value={cicloElegido}
                onChange={(e) => {
                  setCicloElegido(e.target.value);
                  setSeleccionado(null);
                }}
                className="campo"
              >
                <option value="">
                  Todos los ciclos ({detalle.puntos.length} puntos)
                </option>
                {ciclos.map((c) => (
                  <option key={c} value={c}>
                    Ciclo {c || "(sin ciclo)"} (
                    {detalle.puntos.filter((p) => p.ciclo === c).length} puntos)
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => exportarCartera(puntos, v.usuario)}
              className="flex items-center gap-2 rounded-[4px] bg-[var(--color-ambar)] px-3 py-2 text-[13px] font-medium text-white hover:bg-[var(--color-ambar-oscuro)]"
            >
              <Sheet size={15} aria-hidden />
              Descargar en Excel
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
              {generandoImagen ? "Creando imagen" : "Descargar en imagen"}
            </button>
          </div>

          {rutas.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--color-linea)] pt-3">
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
        </section>

        {error && (
          <p
            role="alert"
            className="flex items-center gap-2 rounded-[4px] bg-[#f8ecea] px-3 py-2.5 text-[13px] text-[var(--color-alerta)]"
          >
            <TriangleAlert size={14} className="shrink-0" aria-hidden />
            {error}
          </p>
        )}

        {sinUbicacion > 0 && (
          <p className="flex items-center gap-2 rounded-[4px] bg-[#fdf4e3] px-3 py-2.5 text-[13px] text-[#7a5410]">
            <MapPin size={14} className="shrink-0" aria-hidden />
            {sinUbicacion === 1
              ? "1 punto no tiene ubicación y no aparece en el mapa."
              : `${sinUbicacion} puntos no tienen ubicación y no aparecen en el mapa.`}
          </p>
        )}

        <div className="overflow-hidden rounded-[4px] border border-[var(--color-linea)]">
          <div className="h-[46vh] min-h-[280px] border-b border-[var(--color-linea)]">
            <MapaCliente
              puntos={puntos}
              seleccionado={seleccionado}
              onSeleccionar={setSeleccionado}
            />
          </div>

          <div className="max-h-[60vh] overflow-y-auto bg-[var(--color-papel)]">
            <ListaPuntos
              puntos={puntos}
              seleccionado={seleccionado}
              onSeleccionar={setSeleccionado}
            />
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- búsqueda
  return (
    <div className="space-y-4">
      <section>
        <h2 className="text-sm font-semibold">Consultar la cartera de un consultor</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
          Por usuario, cédula o nombre. Sirve para resolver por teléfono: ves lo
          mismo que ve él y puedes mandarle el Excel o la imagen.
        </p>

        <form onSubmit={buscar} className="mt-3 flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="BAV006, 1013... o JOHN JAIRO"
            className="campo"
            aria-label="Usuario, cédula o nombre del consultor"
          />
          <button
            type="submit"
            disabled={buscando || q.trim().length < 2}
            className="flex shrink-0 items-center gap-2 rounded-[4px] bg-[var(--color-tinta)] px-4 text-sm font-medium text-white disabled:opacity-45"
          >
            {buscando ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <Search size={15} aria-hidden />
            )}
            Buscar
          </button>
        </form>
      </section>

      {error && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-[4px] bg-[#f8ecea] px-3 py-2.5 text-[13px] text-[var(--color-alerta)]"
        >
          <TriangleAlert size={14} className="shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {consultores !== null && consultores.length === 0 && (
        <p className="rounded-[4px] border border-dashed border-[var(--color-linea)] px-4 py-6 text-center text-[13px] text-[var(--color-tinta-suave)]">
          Ningún consultor coincide con esa búsqueda.
        </p>
      )}

      {consultores && consultores.length > 0 && (
        <ul className="divide-y divide-[var(--color-linea)] rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)]">
          {consultores.map((v) => {
            const clave = `${v.usuario}|${v.ccuser}`;
            return (
              <li key={clave}>
                <button
                  type="button"
                  onClick={() => abrir(v)}
                  disabled={abriendo !== null}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#f3f5f2] disabled:opacity-60"
                >
                  <span
                    aria-hidden
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eceeeb] text-[var(--color-tinta-suave)]"
                  >
                    {abriendo === clave ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <User size={15} />
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {v.nom ?? v.usuario}
                    </span>
                    <span className="cifras mt-0.5 block truncate text-xs text-[var(--color-tinta-suave)]">
                      {v.usuario} · cc {v.ccuser}
                      {v.num_de_ruta !== null && ` · ruta ${v.num_de_ruta}`} ·{" "}
                      {v.puntos} puntos ·{" "}
                      {v.ciclos > 1
                        ? `${v.ciclos} ciclos`
                        : `ciclo ${v.ciclo_reciente || "—"}`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
