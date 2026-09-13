"use client";

import dynamic from "next/dynamic";
import type { PuntoCartera } from "@/lib/tipos";

/**
 * Leaflet toca window al importarse, así que el mapa no puede renderizarse
 * en el servidor. Esta envoltura existe para poder usar ssr:false, que en el
 * App Router solo está permitido dentro de un componente de cliente.
 */
const Mapa = dynamic(() => import("./Mapa"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-[#e8eae6]">
      <p className="text-sm text-[var(--color-tinta-suave)]">Cargando mapa…</p>
    </div>
  ),
});

export default function MapaCliente(props: {
  puntos: PuntoCartera[];
  seleccionado?: string | null;
  onSeleccionar?: (idPdv: string) => void;
}) {
  return <Mapa {...props} />;
}
