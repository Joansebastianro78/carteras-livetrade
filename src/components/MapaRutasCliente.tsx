"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type MapaRutasTipo from "./MapaRutas";

/** Igual que los otros mapas: Leaflet toca window al importarse, así que va sin SSR. */
const MapaRutas = dynamic(() => import("./MapaRutas"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-[var(--color-mapa)]">
      <p className="text-sm text-[var(--color-tinta-suave)]">Cargando mapa…</p>
    </div>
  ),
});

export default function MapaRutasCliente(props: ComponentProps<typeof MapaRutasTipo>) {
  return <MapaRutas {...props} />;
}
