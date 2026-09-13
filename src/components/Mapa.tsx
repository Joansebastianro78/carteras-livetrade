"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CENTRO_BOGOTA, colorDeRuta, type PuntoCartera } from "@/lib/tipos";

type Props = {
  puntos: PuntoCartera[];
  seleccionado?: string | null;
  onSeleccionar?: (idPdv: string) => void;
};

function iconoRuta(ruta: number | null, activo: boolean) {
  const color = colorDeRuta(ruta);
  const tam = activo ? 34 : 26;
  return L.divIcon({
    className: "marcador-ruta",
    iconSize: [tam, tam],
    iconAnchor: [tam / 2, tam / 2],
    popupAnchor: [0, -tam / 2],
    html: `<span style="background:${color};${
      activo ? "border-width:3px;box-shadow:0 0 0 3px rgba(22,36,43,.35);" : ""
    }">${ruta ?? ""}</span>`,
  });
}

/** Ajusta el encuadre cada vez que cambia el conjunto de puntos. */
function Encuadrar({ puntos }: { puntos: PuntoCartera[] }) {
  const mapa = useMap();

  useEffect(() => {
    const coords = puntos
      .filter((p) => p.latitud !== null && p.longitud !== null)
      .map((p) => [p.latitud as number, p.longitud as number] as [number, number]);

    if (coords.length === 0) return;
    if (coords.length === 1) {
      mapa.setView(coords[0], 16);
      return;
    }
    mapa.fitBounds(L.latLngBounds(coords), { padding: [40, 40], maxZoom: 17 });
  }, [puntos, mapa]);

  return null;
}

export default function Mapa({ puntos, seleccionado, onSeleccionar }: Props) {
  const conCoords = useMemo(
    () => puntos.filter((p) => p.latitud !== null && p.longitud !== null),
    [puntos]
  );

  return (
    <MapContainer
      center={CENTRO_BOGOTA}
      zoom={12}
      scrollWheelZoom
      className="h-full w-full"
      // El basemap de CARTO exige API key. OpenStreetMap no, y aguanta
      // el volumen de un equipo de campo sin registro previo.
      attributionControl
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
      />

      <Encuadrar puntos={conCoords} />

      {conCoords.map((p) => (
        <Marker
          key={p.id_pdv}
          position={[p.latitud as number, p.longitud as number]}
          icon={iconoRuta(p.ruta, seleccionado === p.id_pdv)}
          eventHandlers={{ click: () => onSeleccionar?.(p.id_pdv) }}
        >
          <Popup>
            <div className="p-3">
              <div
                className="mb-2 inline-flex items-center gap-2 text-xs text-[var(--color-tinta-suave)]"
                style={{ color: colorDeRuta(p.ruta) }}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: colorDeRuta(p.ruta) }}
                />
                Ruta {p.ruta ?? "sin dato"}
              </div>

              <h3 className="text-[15px] leading-snug font-semibold text-[var(--color-tinta)]">
                {p.pdv ?? "Punto sin nombre"}
              </h3>

              <p className="mt-1 text-[13px] leading-snug text-[var(--color-tinta-suave)]">
                {p.direccion ?? "Sin dirección registrada"}
              </p>

              <dl className="mt-3 space-y-1.5 text-[13px]">
                {p.persona_hacku && (
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-[var(--color-tinta-suave)]">Contacto</dt>
                    <dd className="text-[var(--color-tinta)]">{p.persona_hacku}</dd>
                  </div>
                )}
                {p.celular && (
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-[var(--color-tinta-suave)]">Celular</dt>
                    <dd>
                      <a
                        href={`tel:+${p.celular.replace(/\D/g, "")}`}
                        className="cifras font-medium text-[var(--color-tinta)] underline underline-offset-2"
                      >
                        {p.celular}
                      </a>
                    </dd>
                  </div>
                )}
                {p.que_hacer && (
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-[var(--color-tinta-suave)]">Tarea</dt>
                    <dd className="font-medium text-[var(--color-tinta)]">{p.que_hacer}</dd>
                  </div>
                )}
              </dl>

              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${p.latitud},${p.longitud}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block rounded-[4px] bg-[var(--color-tinta)] px-3 py-2 text-center text-[13px] font-medium text-white"
              >
                Cómo llegar
              </a>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
