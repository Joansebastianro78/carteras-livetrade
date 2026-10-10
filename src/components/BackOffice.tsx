"use client";

import { useEffect, useMemo, useState } from "react";
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
import EncabezadoPagina from "./EncabezadoPagina";
import { cifra, sinTildes } from "./ConsultaAthena";
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

/** Los últimos consultores abiertos, en este navegador: a quien se llama seguido. */
type Reciente = { usuario: string; ccuser: string; nom: string | null };
const LLAVE_RECIENTES = "cartera.consultores-recientes";

function leerRecientes(): Reciente[] {
  try {
    const r = JSON.parse(localStorage.getItem(LLAVE_RECIENTES) ?? "[]");
    return Array.isArray(r) ? (r as Reciente[]).slice(0, 6) : [];
  } catch {
    return [];
  }
}

/** "John Jairo Pérez" → "JP". */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  return ((partes[0][0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : (partes[0][1] ?? ""))).toUpperCase();
}

export default function BackOffice() {
  const [q, setQ] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [consultores, setConsultores] = useState<Consultor[] | null>(null);
  const [recientes, setRecientes] = useState<Reciente[]>([]);

  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const [cicloElegido, setCicloElegido] = useState("");
  const [ruta, setRuta] = useState<number | null>(null);
  const [filtroLista, setFiltroLista] = useState("");
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [generandoImagen, setGenerandoImagen] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => setRecientes(leerRecientes()), []);

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

  async function abrir(v: { usuario: string; ccuser: string; nom: string | null }) {
    setAbriendo(`${v.usuario}|${v.ccuser}`);
    setError(null);

    const res = await fetch(
      `/api/admin/consultores?usuario=${encodeURIComponent(v.usuario)}&ccuser=${encodeURIComponent(v.ccuser)}`
    );
    const json = await res.json().catch(() => ({}));
    setAbriendo(null);

    if (!res.ok) {
      setError(json.error ?? "No se pudo abrir la cartera.");
      return;
    }

    setDetalle(json as Detalle);
    setSeleccionado(null);
    setRuta(null);
    setFiltroLista("");
    // Siempre abre con todo lo que tiene asignado el consultor. El filtro por
    // ciclo queda ahí para quien lo necesite.
    setCicloElegido("");

    const nuevo: Reciente = { usuario: v.usuario, ccuser: v.ccuser, nom: (json as Detalle).consultor.nombre ?? v.nom };
    const lista = [nuevo, ...leerRecientes().filter((r) => !(r.usuario === v.usuario && r.ccuser === v.ccuser))].slice(0, 6);
    try {
      localStorage.setItem(LLAVE_RECIENTES, JSON.stringify(lista));
    } catch {
      // Sin almacenamiento solo no quedan los recientes.
    }
    setRecientes(lista);
  }

  // Un consultor puede tener puntos de varios ciclos a la vez.
  const ciclos = useMemo(() => {
    if (!detalle) return [];
    return [...new Set(detalle.puntos.map((p) => p.ciclo))].sort();
  }, [detalle]);

  const delCiclo = useMemo(() => {
    if (!detalle) return [];
    return cicloElegido ? detalle.puntos.filter((p) => p.ciclo === cicloElegido) : detalle.puntos;
  }, [detalle, cicloElegido]);

  const rutas = useMemo(() => {
    const mapa = new Map<number, number>();
    for (const p of delCiclo) {
      const n = numeroDeRuta(p);
      if (n === null) continue;
      mapa.set(n, (mapa.get(n) ?? 0) + 1);
    }
    return [...mapa.entries()].sort((a, b) => a[0] - b[0]);
  }, [delCiclo]);

  /** Lo que se ve en el mapa y en la lista: ciclo, ruta y búsqueda. */
  const puntos = useMemo(() => {
    const texto = sinTildes(filtroLista.trim());
    return delCiclo.filter(
      (p) =>
        (ruta === null || numeroDeRuta(p) === ruta) &&
        (!texto ||
          sinTildes([p.pdv, p.direccion, p.id_pdv, p.bavaria].filter(Boolean).join(" ")).includes(texto))
    );
  }, [delCiclo, ruta, filtroLista]);

  const sinUbicacion = delCiclo.filter((p) => p.latitud === null).length;

  async function descargarImagen() {
    if (!detalle) return;
    setGenerandoImagen(true);
    setError(null);
    try {
      await exportarCarteraImagen(delCiclo, {
        usuario: detalle.consultor.usuario,
        nombre: detalle.consultor.nombre,
      });
    } catch {
      setError("No se pudo crear la imagen. Descarga el Excel mientras tanto.");
    } finally {
      setGenerandoImagen(false);
    }
  }

  const avisoError = error && (
    <p
      role="alert"
      className="flex items-center gap-2 rounded-[4px] bg-[var(--color-alerta-fondo)] px-3 py-2.5 text-[13px] text-[var(--color-alerta)]"
    >
      <TriangleAlert size={14} className="shrink-0" aria-hidden />
      {error}
    </p>
  );

  // ------------------------------------------------------------- detalle
  if (detalle) {
    const v = detalle.consultor;
    const nombre = v.nombre ?? v.usuario;

    return (
      <div className="space-y-5">
        <button
          type="button"
          onClick={() => setDetalle(null)}
          className="flex items-center gap-1.5 text-[13px] text-[var(--color-tinta-suave)] hover:text-[var(--color-tinta)]"
        >
          <ArrowLeft size={14} aria-hidden />
          Volver a la búsqueda
        </button>

        <section className="tarjeta flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
          <span
            aria-hidden
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--color-tinta)] font-semibold text-[var(--color-sobre-tinta)]"
          >
            {iniciales(nombre)}
          </span>
          <div className="min-w-0 flex-[1_1_240px]">
            <h1 className="text-[20px] leading-tight font-semibold">
              {nombre} <span className="font-normal text-[var(--color-tinta-suave)]">· {v.usuario}</span>
            </h1>
            <p className="cifras mt-1 text-[13px] text-[var(--color-tinta-suave)]">
              cc {v.ccuser}
              {v.numDeRuta !== null && ` · ruta ${v.numDeRuta}`} · {cifra(delCiclo.length)}{" "}
              {delCiclo.length === 1 ? "punto" : "puntos"}
              {rutas.length > 0 && ` en ${rutas.length} ${rutas.length === 1 ? "ruta" : "rutas"}`}
              {sinUbicacion > 0 && ` · ${cifra(sinUbicacion)} sin coordenadas`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {ciclos.length > 1 && (
              <div className="w-[220px]">
                <label htmlFor="ciclo-backoffice" className="sr-only">
                  Ciclo
                </label>
                <select
                  id="ciclo-backoffice"
                  value={cicloElegido}
                  onChange={(e) => {
                    setCicloElegido(e.target.value);
                    setSeleccionado(null);
                    setRuta(null);
                  }}
                  className="campo"
                >
                  <option value="">Todos los ciclos ({cifra(detalle.puntos.length)})</option>
                  {ciclos.map((c) => (
                    <option key={c} value={c}>
                      Ciclo {c || "(sin ciclo)"} ({cifra(detalle.puntos.filter((p) => p.ciclo === c).length)})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              type="button"
              onClick={descargarImagen}
              disabled={generandoImagen}
              className="boton boton-secundario"
            >
              {generandoImagen ? (
                <Loader2 size={16} className="animate-spin" aria-hidden />
              ) : (
                <Imagen size={16} aria-hidden />
              )}
              {generandoImagen ? "Creando imagen" : "Descargar imagen"}
            </button>
            <button
              type="button"
              onClick={() => exportarCartera(delCiclo, v.usuario)}
              className="boton boton-ambar"
            >
              <Sheet size={16} aria-hidden />
              Descargar Excel
            </button>
          </div>
        </section>

        {avisoError}

        {sinUbicacion > 0 && (
          <p className="flex items-center gap-2 rounded-[4px] bg-[var(--color-aviso-fondo)] px-3 py-2.5 text-[13px] text-[var(--color-aviso-tinta)]">
            <MapPin size={14} className="shrink-0" aria-hidden />
            {sinUbicacion === 1
              ? "1 punto no tiene ubicación y no aparece en el mapa."
              : `${cifra(sinUbicacion)} puntos no tienen ubicación y no aparecen en el mapa.`}
          </p>
        )}

        <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section
            aria-label="Mapa de la cartera"
            className="tarjeta h-[46vh] min-h-[300px] overflow-hidden lg:h-[600px]"
          >
            <MapaCliente puntos={puntos} seleccionado={seleccionado} onSeleccionar={setSeleccionado} />
          </section>

          <section aria-labelledby="puntos-consultor" className="tarjeta flex min-h-0 flex-col overflow-hidden lg:h-[600px]">
            <div className="space-y-3 border-b border-[var(--color-linea)] px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 id="puntos-consultor" className="text-[15px] font-semibold">
                  Puntos
                </h2>
                <span className="cifras text-xs text-[var(--color-tinta-suave)]">
                  {puntos.length === delCiclo.length
                    ? cifra(puntos.length)
                    : `${cifra(puntos.length)} de ${cifra(delCiclo.length)}`}
                </span>
              </div>
              {rutas.length > 1 && (
                <div role="group" aria-label="Filtrar por ruta" className="flex flex-wrap gap-1.5">
                  <button type="button" aria-pressed={ruta === null} onClick={() => setRuta(null)} className="chip min-h-[30px] text-xs">
                    Todas
                  </button>
                  {rutas.map(([n, cuantos]) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={ruta === n}
                      onClick={() => {
                        setRuta(ruta === n ? null : n);
                        setSeleccionado(null);
                      }}
                      className="chip min-h-[30px] text-xs"
                    >
                      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: colorDeRuta(n) }} />
                      <span className="cifras">
                        Ruta {n} · {cuantos}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div>
                <label htmlFor="buscar-en-puntos" className="sr-only">
                  Buscar en los puntos
                </label>
                <input
                  id="buscar-en-puntos"
                  type="search"
                  value={filtroLista}
                  onChange={(e) => setFiltroLista(e.target.value)}
                  placeholder="Buscar PDV, dirección o código"
                  className="campo"
                />
              </div>
            </div>
            <div className="max-h-[60vh] min-h-0 flex-1 overflow-y-auto lg:max-h-none">
              <ListaPuntos puntos={puntos} seleccionado={seleccionado} onSeleccionar={setSeleccionado} />
            </div>
          </section>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- búsqueda
  return (
    <div className="space-y-5">
      <EncabezadoPagina
        titulo="Cartera de un consultor"
        descripcion="Para resolver por teléfono: ves lo mismo que el consultor ve en su celular y le puedes mandar el Excel o la imagen."
      />

      <section className="tarjeta px-4 py-4 sm:px-5">
        <form onSubmit={buscar} className="flex flex-wrap gap-2.5">
          <div className="min-w-0 flex-[1_1_320px]">
            <label htmlFor="buscar-consultor" className="sr-only">
              Usuario, cédula o nombre del consultor
            </label>
            <input
              id="buscar-consultor"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Usuario, cédula o nombre: BAV006, 1013… o JOHN JAIRO"
              className="campo"
            />
          </div>
          <button type="submit" disabled={buscando || q.trim().length < 2} className="boton boton-primario">
            {buscando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Search size={16} aria-hidden />}
            Buscar
          </button>
        </form>

        {recientes.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-[var(--color-tinta-suave)]">Recientes:</span>
            {recientes.map((r) => (
              <button
                key={`${r.usuario}|${r.ccuser}`}
                type="button"
                onClick={() => abrir(r)}
                disabled={abriendo !== null}
                title={r.nom ?? r.usuario}
                className="chip min-h-[30px] text-xs"
              >
                {abriendo === `${r.usuario}|${r.ccuser}` && (
                  <Loader2 size={12} className="animate-spin" aria-hidden />
                )}
                {r.usuario}
              </button>
            ))}
          </div>
        )}
      </section>

      {avisoError}

      {consultores !== null && consultores.length === 0 && (
        <p className="rounded-[4px] border border-dashed border-[var(--color-linea)] px-4 py-6 text-center text-[13px] text-[var(--color-tinta-suave)]">
          Ningún consultor coincide con esa búsqueda.
        </p>
      )}

      {consultores && consultores.length > 0 && (
        <ul className="tarjeta divide-y divide-[var(--color-linea)] overflow-hidden">
          {consultores.map((v) => {
            const clave = `${v.usuario}|${v.ccuser}`;
            return (
              <li key={clave}>
                <button
                  type="button"
                  onClick={() => abrir(v)}
                  disabled={abriendo !== null}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-hover)] disabled:opacity-60"
                >
                  <span
                    aria-hidden
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--color-relleno)] text-[var(--color-tinta-suave)]"
                  >
                    {abriendo === clave ? <Loader2 size={15} className="animate-spin" /> : <User size={16} />}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{v.nom ?? v.usuario}</span>
                    <span className="cifras mt-0.5 block truncate text-xs text-[var(--color-tinta-suave)]">
                      {v.usuario} · cc {v.ccuser}
                      {v.num_de_ruta !== null && ` · ruta ${v.num_de_ruta}`} · {cifra(v.puntos)} puntos ·{" "}
                      {v.ciclos > 1 ? `${v.ciclos} ciclos` : `ciclo ${v.ciclo_reciente || "—"}`}
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
