"use client";

import { useState } from "react";
import BackOffice from "./BackOffice";
import FiltroTerritorio from "./FiltroTerritorio";
import VisorTableros from "./VisorTableros";

const SECCIONES = [
  { id: "consultores", titulo: "Consultores" },
  { id: "territorio", titulo: "Departamento y ciudad" },
  { id: "tableros", titulo: "Tableros" },
] as const;

type Seccion = (typeof SECCIONES)[number]["id"];

export default function PanelBackOffice() {
  const [activa, setActiva] = useState<Seccion>("consultores");

  return (
    <>
      <nav
        aria-label="Secciones del BackOffice"
        className="flex flex-wrap gap-1 border-b border-[var(--color-linea)]"
      >
        {SECCIONES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiva(s.id)}
            aria-current={activa === s.id ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm ${
              activa === s.id
                ? "border-[var(--color-tinta)] font-medium text-[var(--color-tinta)]"
                : "border-transparent text-[var(--color-tinta-suave)] hover:text-[var(--color-tinta)]"
            }`}
          >
            {s.titulo}
          </button>
        ))}
      </nav>

      <div className="pt-7">
        {activa === "consultores" && <BackOffice />}
        {activa === "territorio" && <FiltroTerritorio />}
        {activa === "tableros" && <VisorTableros />}
      </div>
    </>
  );
}
