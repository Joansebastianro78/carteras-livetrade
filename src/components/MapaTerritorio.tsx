"use client";

import { useEffect, useRef } from "react";
import { MapContainer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import CapasMapa from "./CapasMapa";
import {
  claveGrupo,
  nombreCiudad,
  type Agrupacion,
  type PuntoTerritorio,
  type SeleccionPunto,
} from "@/lib/territorio";

type Props = {
  puntos: PuntoTerritorio[];
  /** Color por departamento o por ciudad, según agruparPor. */
  colores: Map<string, string>;
  agruparPor: Agrupacion;
  seleccionado: SeleccionPunto | null;
  onSeleccionar: (idRegistro: number) => void;
};

const COLOR_POR_DEFECTO = "#6B7B80";
const CENTRO_COLOMBIA: [number, number] = [4.6, -74.1];

/**
 * Contenido del globo armado con nodos y textContent, no con HTML en una
 * cadena: los nombres y direcciones vienen de un Excel y podrían traer
 * cualquier cosa.
 */
function contenidoGlobo(p: PuntoTerritorio): HTMLElement {
  const raiz = document.createElement("div");
  raiz.className = "p-3";

  const ciudad = document.createElement("p");
  ciudad.className = "text-xs text-[var(--color-tinta-suave)]";
  ciudad.textContent = [nombreCiudad(p.ciudad), p.departamento?.trim()]
    .filter(Boolean)
    .join(", ");
  raiz.appendChild(ciudad);

  const titulo = document.createElement("h3");
  titulo.className = "mt-1 text-[15px] leading-snug font-semibold text-[var(--color-tinta)]";
  titulo.textContent = p.pdv ?? "Punto sin nombre";
  raiz.appendChild(titulo);

  const direccion = document.createElement("p");
  direccion.className = "mt-1 text-[13px] leading-snug text-[var(--color-tinta-suave)]";
  direccion.textContent = p.direccion ?? "Sin dirección registrada";
  raiz.appendChild(direccion);

  const datos = document.createElement("dl");
  datos.className = "mt-3 space-y-1.5 text-[13px]";

  const fila = (etiqueta: string, valor: string | null) => {
    if (!valor) return;
    const contenedor = document.createElement("div");
    contenedor.className = "flex gap-2";
    const dt = document.createElement("dt");
    dt.className = "shrink-0 text-[var(--color-tinta-suave)]";
    dt.textContent = etiqueta;
    const dd = document.createElement("dd");
    dd.className = "text-[var(--color-tinta)]";
    dd.textContent = valor;
    contenedor.append(dt, dd);
    datos.appendChild(contenedor);
  };

  fila("Consultor", p.nom ? `${p.nom} (${p.usuario})` : p.usuario);
  fila("Tarea", p.que_hacer);
  fila("Ciclo", p.ciclo || null);
  raiz.appendChild(datos);

  return raiz;
}

/**
 * Los marcadores se dibujan en un canvas y fuera de React: una región puede
 * tener miles de puntos, y un marcador HTML por cada uno vuelve lento el mapa
 * en un computador de oficina.
 */
function CapaPuntos({ puntos, colores, agruparPor, seleccionado, onSeleccionar }: Props) {
  const mapa = useMap();
  const marcadores = useRef(new Map<number, L.CircleMarker>());
  const anterior = useRef<number | null>(null);

  // La función cambia en cada render del padre; el ref evita rehacer la capa.
  const alSeleccionar = useRef(onSeleccionar);
  useEffect(() => {
    alSeleccionar.current = onSeleccionar;
  });

  useEffect(() => {
    const lienzo = L.canvas({ padding: 0.5 });
    const capa = L.layerGroup();
    const coords: L.LatLngTuple[] = [];
    marcadores.current.clear();
    anterior.current = null;

    for (const p of puntos) {
      if (p.latitud === null || p.longitud === null) continue;

      const marcador = L.circleMarker([p.latitud, p.longitud], {
        renderer: lienzo,
        radius: 6,
        color: "#ffffff",
        weight: 1.5,
        fillColor: colores.get(claveGrupo(p, agruparPor)) ?? COLOR_POR_DEFECTO,
        fillOpacity: 0.92,
      });

      // Margen al acomodar la vista para que el globo no quede pegado al borde.
      marcador.bindPopup(() => contenidoGlobo(p), { autoPanPadding: [24, 24] });
      marcador.on("click", () => alSeleccionar.current(p.id_registro));

      capa.addLayer(marcador);
      marcadores.current.set(p.id_registro, marcador);
      coords.push([p.latitud, p.longitud]);
    }

    capa.addTo(mapa);

    if (coords.length === 1) mapa.setView(coords[0], 16);
    else if (coords.length > 1) {
      mapa.fitBounds(L.latLngBounds(coords), { padding: [30, 30], maxZoom: 16 });
    }

    return () => {
      capa.remove();
    };
  }, [puntos, colores, agruparPor, mapa]);

  // Al elegir un punto: se agranda y, si vino de la lista, el mapa va hasta él.
  useEffect(() => {
    if (anterior.current !== null) {
      marcadores.current.get(anterior.current)?.setStyle({ radius: 6, weight: 1.5 });
    }
    anterior.current = seleccionado?.id ?? null;

    if (!seleccionado) return;
    const marcador = marcadores.current.get(seleccionado.id);
    if (!marcador) return;

    marcador.setStyle({ radius: 10, weight: 3 });
    marcador.bringToFront();

    // Tocado en el mapa: Leaflet ya abrió el globo y movió la vista para que
    // quepa entero. Volver a centrar aquí deshacía ese ajuste y el globo
    // quedaba cortado por arriba.
    if (seleccionado.desde === "mapa") return;

    // Elegido en la lista: primero se mueve el mapa y, cuando termina, se abre
    // el globo. Abierto a mitad del movimiento, Leaflet no alcanza a acomodarlo.
    const abrir = () => marcador.openPopup();
    mapa.closePopup();
    mapa.once("moveend", abrir);
    mapa.setView(marcador.getLatLng(), Math.max(mapa.getZoom(), 16));

    return () => {
      mapa.off("moveend", abrir);
    };
  }, [seleccionado, mapa]);

  return null;
}

export default function MapaTerritorio(props: Props) {
  return (
    <MapContainer
      center={CENTRO_COLOMBIA}
      zoom={6}
      maxZoom={19}
      scrollWheelZoom
      className="h-full w-full"
    >
      <CapasMapa />
      <CapaPuntos {...props} />
    </MapContainer>
  );
}
