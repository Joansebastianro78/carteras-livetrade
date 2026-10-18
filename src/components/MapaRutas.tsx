"use client";

import { useEffect, useRef } from "react";
import { MapContainer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import CapasMapa from "./CapasMapa";
import { envolvente } from "@/lib/rutas";
import type { DatoFila } from "@/lib/rutasExcel";

export type PuntoRuta = {
  /** Índice de la fila en el archivo (el mismo de ResultadoRutas.ruta). */
  i: number;
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
  /** Cambia cuando hay que volver a encuadrar (otro archivo u otra hoja); asignar puntos no mueve el mapa. */
  claveVista: string;
  /** Modo seleccionar: arrastrar dibuja un lazo y tocar un punto lo marca o desmarca. */
  seleccionando?: boolean;
  /** Índices (PuntoRuta.i) seleccionados, con un anillo encima. */
  seleccion?: ReadonlySet<number>;
  /** «agregar»: los que quedaron dentro del lazo. «alternar»: el punto tocado. */
  onSeleccion?: (indices: number[], modo: "agregar" | "alternar") => void;
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
function Capas({ puntos, generado, colorDe, enfocada, claveVista, seleccionando = false, seleccion, onSeleccion }: Props) {
  const mapa = useMap();
  const puntosRef = useRef(puntos);
  puntosRef.current = puntos;
  const alSeleccionar = useRef(onSeleccion);
  alSeleccionar.current = onSeleccion;

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
      // Seleccionando, tocar un punto lo marca (lo maneja el lazo); el globo, solo fuera de ese modo.
      if (!seleccionando) marcador.bindPopup(() => contenidoGlobo(p, generado), { autoPanPadding: [24, 24] });
      capa.addLayer(marcador);
    }
    capa.addTo(mapa);

    return () => {
      capa.remove();
    };
  }, [puntos, generado, colorDe, enfocada, seleccionando, mapa]);

  // Encuadre: al cambiar de archivo o de ruta enfocada, no cada vez que se asignan puntos.
  useEffect(() => {
    const coords: L.LatLngTuple[] = puntosRef.current
      .filter((p) => enfocada === null || p.ruta === enfocada)
      .map((p) => [p.lat, p.lon]);
    if (coords.length === 1) mapa.setView(coords[0], 16);
    else if (coords.length > 1) mapa.fitBounds(L.latLngBounds(coords), { padding: [36, 36], maxZoom: 16 });
  }, [claveVista, enfocada, mapa]);

  // Los seleccionados: un anillo oscuro encima, en su propia capa para no redibujar todo.
  useEffect(() => {
    if (!seleccion || seleccion.size === 0) return;
    const lienzo = L.canvas({ padding: 0.5 });
    const capa = L.layerGroup();
    for (const p of puntos) {
      if (!seleccion.has(p.i)) continue;
      L.circleMarker([p.lat, p.lon], {
        renderer: lienzo,
        radius: 9,
        color: "#111827",
        weight: 3,
        fill: false,
        interactive: false,
      }).addTo(capa);
    }
    capa.addTo(mapa);
    return () => {
      capa.remove();
    };
  }, [puntos, seleccion, mapa]);

  // El lazo: con el modo seleccionar, arrastrar dibuja y suelta los puntos que quedaron dentro; un toque marca el más cercano.
  useEffect(() => {
    if (!seleccionando) return;
    const caja = mapa.getContainer();
    mapa.dragging.disable();
    mapa.doubleClickZoom.disable();
    const antes = { cursor: caja.style.cursor, touchAction: caja.style.touchAction };
    caja.style.cursor = "crosshair";
    caja.style.touchAction = "none";

    let trazo: L.Point[] | null = null;
    let linea: L.Polyline | null = null;

    const alBajar = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest(".leaflet-control-container, .leaflet-popup")) return;
      e.preventDefault();
      caja.setPointerCapture(e.pointerId);
      trazo = [mapa.mouseEventToContainerPoint(e as unknown as MouseEvent)];
      linea = L.polyline([mapa.containerPointToLatLng(trazo[0])], {
        color: "#111827",
        weight: 2,
        dashArray: "5 5",
        interactive: false,
      }).addTo(mapa);
    };
    const alMover = (e: PointerEvent) => {
      if (!trazo || !linea) return;
      const q = mapa.mouseEventToContainerPoint(e as unknown as MouseEvent);
      if (q.distanceTo(trazo[trazo.length - 1]) < 3) return;
      trazo.push(q);
      linea.addLatLng(mapa.containerPointToLatLng(q));
    };
    const alSoltar = (e: PointerEvent) => {
      if (!trazo) return;
      const camino = trazo;
      trazo = null;
      linea?.remove();
      linea = null;
      if (caja.hasPointerCapture(e.pointerId)) caja.releasePointerCapture(e.pointerId);
      const inicio = camino[0];
      const lejos = Math.max(...camino.map((q) => q.distanceTo(inicio)));
      const visibles = puntosRef.current.map((p) => ({ i: p.i, q: mapa.latLngToContainerPoint([p.lat, p.lon]) }));
      if (lejos < 6 || camino.length < 3) {
        // Un toque: el punto más cercano, si está a menos de 12 px.
        let mejor: { i: number; d: number } | null = null;
        for (const v of visibles) {
          const d = v.q.distanceTo(inicio);
          if (d <= 12 && (!mejor || d < mejor.d)) mejor = { i: v.i, d };
        }
        if (mejor) alSeleccionar.current?.([mejor.i], "alternar");
        return;
      }
      const dentro = visibles.filter((v) => dentroDe(camino, v.q)).map((v) => v.i);
      if (dentro.length) alSeleccionar.current?.(dentro, "agregar");
    };

    caja.addEventListener("pointerdown", alBajar);
    caja.addEventListener("pointermove", alMover);
    caja.addEventListener("pointerup", alSoltar);
    caja.addEventListener("pointercancel", alSoltar);
    return () => {
      caja.removeEventListener("pointerdown", alBajar);
      caja.removeEventListener("pointermove", alMover);
      caja.removeEventListener("pointerup", alSoltar);
      caja.removeEventListener("pointercancel", alSoltar);
      linea?.remove();
      mapa.dragging.enable();
      mapa.doubleClickZoom.enable();
      caja.style.cursor = antes.cursor;
      caja.style.touchAction = antes.touchAction;
    };
  }, [seleccionando, mapa]);

  return null;
}

/** Si el punto q queda dentro del lazo (polígono cerrado por la última y la primera posición). */
function dentroDe(poligono: L.Point[], q: L.Point): boolean {
  let dentro = false;
  for (let a = 0, b = poligono.length - 1; a < poligono.length; b = a++) {
    const pa = poligono[a];
    const pb = poligono[b];
    if (pa.y > q.y !== pb.y > q.y && q.x < ((pb.x - pa.x) * (q.y - pa.y)) / (pb.y - pa.y) + pa.x) dentro = !dentro;
  }
  return dentro;
}

export default function MapaRutas(props: Props) {
  return (
    <MapContainer center={CENTRO_COLOMBIA} zoom={6} maxZoom={19} scrollWheelZoom className="h-full w-full">
      <CapasMapa />
      <Capas {...props} />
    </MapContainer>
  );
}
