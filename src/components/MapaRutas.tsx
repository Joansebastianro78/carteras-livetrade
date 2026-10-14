"use client";

import { useEffect } from "react";
import { MapContainer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import CapasMapa from "./CapasMapa";
import { envolvente } from "@/lib/rutas";
import type { DatoFila } from "@/lib/rutasExcel";

export type PuntoRuta = {
  lat: number;
  lon: number;
  /** null: todavía sin generar, o el punto quedó sin asignar. */
  ruta: number | null;
  persona: string | null;
  info: DatoFila;
};

type Props = {
  puntos: PuntoRuta[];
  /** Ya se generaron las rutas: se colorea por ruta. Antes, todos en gris. */
  generado: boolean;
  colorDe: (ruta: number | null) => string;
  /** Ruta elegida en la leyenda: se acerca y las demás se apagan. */
  enfocada: number | null;
};

const CENTRO_COLOMBIA: [number, number] = [4.6, -74.1];

/** El globo, armado con nodos y textContent: los textos vienen de un Excel. */
function contenidoGlobo(p: PuntoRuta, generado: boolean): HTMLElement {
  const raiz = document.createElement("div");
  raiz.className = "p-3";
  const fila = document.createElement("p");
  fila.className = "text-xs text-[var(--color-tinta-suave)]";
  fila.textContent = [`Fila ${p.info.fila}`, p.info.id].filter(Boolean).join(" · ");
  raiz.appendChild(fila);
  const titulo = document.createElement("h3");
  titulo.className = "mt-1 text-[15px] leading-snug font-semibold text-[var(--color-tinta)]";
  titulo.textContent = p.info.nombre ?? "Punto sin nombre";
  raiz.appendChild(titulo);
  if (p.info.direccion) {
    const dir = document.createElement("p");
    dir.className = "mt-1 text-[13px] leading-snug text-[var(--color-tinta-suave)]";
    dir.textContent = p.info.direccion;
    raiz.appendChild(dir);
  }
  if (generado) {
    const ruta = document.createElement("p");
    ruta.className = "mt-2 text-[13px] font-medium text-[var(--color-tinta)]";
    ruta.textContent = p.ruta ? `Ruta ${p.ruta} · ${p.persona}` : "Sin asignar: no cupo en ninguna ruta";
    raiz.appendChild(ruta);
  }
  return raiz;
}

/**
 * Puntos en canvas (pueden ser miles), el contorno de cada ruta y su número
 * en el centro. Se dibuja fuera de React, como el mapa de Departamento y
 * ciudad.
 */
function Capas({ puntos, generado, colorDe, enfocada }: Props) {
  const mapa = useMap();

  useEffect(() => {
    const lienzo = L.canvas({ padding: 0.5 });
    const capa = L.layerGroup();
    const apagado = (r: number | null) => enfocada !== null && r !== enfocada;

    if (generado) {
      // Contorno de cada ruta, debajo de los puntos.
      const porRuta = new Map<number, [number, number][]>();
      for (const p of puntos) if (p.ruta !== null) (porRuta.get(p.ruta) ?? porRuta.set(p.ruta, []).get(p.ruta)!).push([p.lat, p.lon]);
      for (const [ruta, coords] of porRuta) {
        const color = colorDe(ruta);
        const borde = envolvente(coords);
        if (borde.length >= 3) {
          L.polygon(borde, {
            renderer: lienzo,
            color,
            weight: apagado(ruta) ? 1 : 2,
            opacity: apagado(ruta) ? 0.25 : 0.9,
            fillColor: color,
            fillOpacity: apagado(ruta) ? 0.03 : 0.12,
            interactive: false,
          }).addTo(capa);
        }
        // El número de la ruta en su centro.
        const cLat = coords.reduce((a, c) => a + c[0], 0) / coords.length;
        const cLon = coords.reduce((a, c) => a + c[1], 0) / coords.length;
        L.marker([cLat, cLon], {
          interactive: false,
          keyboard: false,
          opacity: apagado(ruta) ? 0.35 : 1,
          icon: L.divIcon({
            className: "",
            html: `<span style="display:grid;place-items:center;width:26px;height:26px;border-radius:9999px;background:${color};color:#fff;font:600 12px/1 system-ui,sans-serif;box-shadow:0 0 0 2px #fff,0 2px 6px rgb(0 0 0 / .3)">${ruta}</span>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
        }).addTo(capa);
      }
    }

    const coords: L.LatLngTuple[] = [];
    for (const p of puntos) {
      const sinRuta = generado && p.ruta === null;
      const marcador = L.circleMarker([p.lat, p.lon], {
        renderer: lienzo,
        radius: generado ? 6 : 5,
        color: sinRuta ? "#5f6670" : "#ffffff",
        weight: sinRuta ? 2 : 1.5,
        fillColor: generado ? (sinRuta ? "#ffffff" : colorDe(p.ruta)) : "#7c8293",
        fillOpacity: apagado(p.ruta) ? 0.18 : 0.95,
        opacity: apagado(p.ruta) ? 0.3 : 1,
      });
      marcador.bindPopup(() => contenidoGlobo(p, generado), { autoPanPadding: [24, 24] });
      capa.addLayer(marcador);
      if (enfocada === null || p.ruta === enfocada) coords.push([p.lat, p.lon]);
    }
    capa.addTo(mapa);

    if (coords.length === 1) mapa.setView(coords[0], 16);
    else if (coords.length > 1) mapa.fitBounds(L.latLngBounds(coords), { padding: [36, 36], maxZoom: 16 });

    return () => {
      capa.remove();
    };
  }, [puntos, generado, colorDe, enfocada, mapa]);

  return null;
}

export default function MapaRutas(props: Props) {
  return (
    <MapContainer center={CENTRO_COLOMBIA} zoom={6} maxZoom={19} scrollWheelZoom className="h-full w-full">
      <CapasMapa />
      <Capas {...props} />
    </MapContainer>
  );
}
