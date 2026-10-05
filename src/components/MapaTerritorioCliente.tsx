"use client";

import dynamic from "next/dynamic";
import type { Agrupacion, PuntoTerritorio, SeleccionPunto } from "@/lib/territorio";

/** Igual que MapaCliente: Leaflet toca window al importarse, así que va sin SSR. */
const MapaTerritorio = dynamic(() => import("./MapaTerritorio"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-[#e8eae6]">
      <p className="text-sm text-[var(--color-tinta-suave)]">Cargando mapa…</p>
    </div>
  ),
});

export default function MapaTerritorioCliente(props: {
  puntos: PuntoTerritorio[];
  colores: Map<string, string>;
  agruparPor: Agrupacion;
  seleccionado: SeleccionPunto | null;
  onSeleccionar: (idRegistro: number) => void;
}) {
  return <MapaTerritorio {...props} />;
}
