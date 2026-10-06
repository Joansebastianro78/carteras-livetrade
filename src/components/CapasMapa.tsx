"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "maplibre-gl/dist/maplibre-gl.css";
import { Layers } from "lucide-react";
import {
  CAPA_POR_DEFECTO,
  CAPAS,
  buscarCapa,
  capaGuardada,
  guardarCapa,
  type Capa,
  type IdCapa,
} from "@/lib/mapaBase";

/**
 * Miniatura de MapLibre. Es vectorial y no tiene un tile en imagen que
 * mostrar, así que se dibuja con los colores de su estilo (Liberty).
 */
function MiniaturaVectorial() {
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
      <rect width="64" height="64" fill="#f2efe9" />
      <path d="M0 40 C14 34 22 46 36 40 S56 30 64 34 V64 H0Z" fill="#aad3df" />
      <rect x="6" y="6" width="22" height="18" rx="2" fill="#cdebb0" />
      <path d="M0 28 H64" stroke="#d6cfc4" strokeWidth="6" />
      <path d="M0 28 H64" stroke="#ffffff" strokeWidth="4" />
      <path d="M40 0 V64" stroke="#d6cfc4" strokeWidth="6" />
      <path d="M40 0 V64" stroke="#fcd6a4" strokeWidth="4" />
      <path d="M14 28 L4 64 M52 0 L58 28" stroke="#ffffff" strokeWidth="2.5" />
    </svg>
  );
}

function Miniatura({ capa, className }: { capa: Capa; className: string }) {
  const [rota, setRota] = useState(false);

  return (
    <span className={`block overflow-hidden bg-[#dfe4e1] ${className}`}>
      {capa.miniatura && !rota ? (
        // eslint-disable-next-line @next/next/no-img-element -- tile externo, sin optimizar
        <img
          src={capa.miniatura}
          alt=""
          loading="lazy"
          onError={() => setRota(true)}
          className="h-full w-full object-cover"
        />
      ) : capa.fuente.tipo === "maplibre" ? (
        <MiniaturaVectorial />
      ) : null}
    </span>
  );
}

/**
 * Capa base del mapa más el botón "Capas" abajo a la izquierda, al estilo de
 * Google Maps. Va dentro de un <MapContainer>. La elección se guarda en el
 * navegador: cada consultor ve el mapa como lo dejó la última vez, en todos
 * los mapas de la app y también en la imagen que descarga.
 */
export default function CapasMapa() {
  const mapa = useMap();
  const [contenedor, setContenedor] = useState<HTMLElement | null>(null);
  const [capa, setCapa] = useState<IdCapa>(() => capaGuardada());
  const [abierto, setAbierto] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const raiz = useRef<HTMLDivElement>(null);

  // --------------------------------------------------- control de Leaflet
  // El botón vive dentro de un control de Leaflet para quedar en la esquina
  // con el mismo margen que el zoom y sin que un toque mueva el mapa.
  useEffect(() => {
    const control = new L.Control({ position: "bottomleft" });
    control.onAdd = () => {
      const div = L.DomUtil.create("div", "capas-control");
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      return div;
    };
    control.addTo(mapa);
    setContenedor(control.getContainer() ?? null);
    return () => {
      control.remove();
    };
  }, [mapa]);

  // ------------------------------------------------------------ capa base
  useEffect(() => {
    const def = buscarCapa(capa);
    let actual: L.Layer | null = null;
    let vigente = true;

    if (def.fuente.tipo === "raster") {
      const f = def.fuente;
      actual = L.tileLayer(f.url, {
        attribution: f.attribution,
        tileSize: f.tileSize,
        zoomOffset: f.zoomOffset,
        maxZoom: f.maxZoom,
      }).addTo(mapa);
    } else {
      const estilo = def.fuente.estilo;
      // MapLibre GL pesa bastante: solo se descarga si alguien elige esta capa.
      import("@maplibre/maplibre-gl-leaflet")
        .then(({ maplibreGL }) => {
          if (!vigente) return;
          actual = maplibreGL({ style: estilo }).addTo(mapa);
        })
        .catch(() => {
          // Sin WebGL (equipos viejos o con aceleración apagada) MapLibre no
          // puede dibujar. Se vuelve a la capa por defecto y se avisa.
          if (!vigente) return;
          setAviso("Este dispositivo no puede mostrar la capa MapLibre.");
          setCapa(CAPA_POR_DEFECTO);
        });
    }

    return () => {
      vigente = false;
      actual?.remove();
    };
  }, [capa, mapa]);

  // El aviso se va solo.
  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso(null), 5000);
    return () => window.clearTimeout(t);
  }, [aviso]);

  // Cerrar el selector al tocar fuera o con Escape.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  function elegir(id: IdCapa) {
    setCapa(id);
    guardarCapa(id);
    setAbierto(false);
  }

  if (!contenedor) return null;

  const actual = buscarCapa(capa);
  // Como en Google Maps, el botón muestra la capa a la que uno cambiaría:
  // desde calles se ve satélite, y desde cualquier otra se ve calles.
  const sugerida = CAPAS.find((c) => c.id !== capa) ?? actual;

  return createPortal(
    <div ref={raiz} className="relative">
      {aviso && (
        <p
          role="status"
          className="absolute bottom-full left-0 mb-2 w-[220px] rounded-[6px] bg-[var(--color-tinta)] px-3 py-2 text-xs leading-snug text-white shadow-[0_4px_16px_rgb(22_36_43/0.25)]"
        >
          {aviso}
        </p>
      )}

      {abierto && (
        <div
          role="group"
          aria-label="Capas del mapa"
          className="absolute bottom-full left-0 mb-2 flex w-max max-w-[min(360px,calc(100vw-48px))] flex-wrap gap-1 rounded-[8px] bg-white p-2 shadow-[0_4px_16px_rgb(22_36_43/0.25)]"
        >
          {CAPAS.map((c) => {
            const elegida = c.id === capa;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={elegida}
                onClick={() => elegir(c.id)}
                className="flex w-[66px] flex-col items-center gap-1 rounded-[6px] p-1 hover:bg-[#f3f5f2]"
              >
                <Miniatura
                  capa={c}
                  className={`h-[52px] w-[52px] rounded-[6px] border-2 ${
                    elegida ? "border-[#1F6F8B]" : "border-[var(--color-linea)]"
                  }`}
                />
                <span
                  className={`text-center text-[11px] leading-tight ${
                    elegida
                      ? "font-semibold text-[#1F6F8B]"
                      : "text-[var(--color-tinta)]"
                  }`}
                >
                  {c.nombre}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        aria-expanded={abierto}
        aria-label={`Capas del mapa. Ahora se ve: ${actual.nombre}`}
        onClick={() => setAbierto((v) => !v)}
        className="relative block h-[64px] w-[64px] overflow-hidden rounded-[8px] border-2 border-white shadow-[0_1px_6px_rgb(22_36_43/0.45)]"
      >
        <Miniatura capa={sugerida} className="h-full w-full" />
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/75 to-transparent pt-4 pb-1 text-[11px] font-medium text-white">
          <Layers size={12} aria-hidden />
          Capas
        </span>
      </button>
    </div>,
    contenedor
  );
}
