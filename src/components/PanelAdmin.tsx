"use client";

import { useState } from "react";
import Cargador from "./Cargador";
import EditorCartera from "./EditorCartera";
import AdminUsuarios from "./AdminUsuarios";
import Auditoria from "./Auditoria";
import AuditoriaImagenes from "./AuditoriaImagenes";
import BackOffice from "./BackOffice";
import FiltroTerritorio from "./FiltroTerritorio";
import Mantenimiento from "./Mantenimiento";
import PanelTemas from "./PanelTemas";
import PanelTableros from "./PanelTableros";

const SECCIONES = [
  { id: "cargar", titulo: "Cargar plantilla" },
  { id: "editar", titulo: "Editar cartera" },
  { id: "backoffice", titulo: "BackOffice" },
  { id: "territorio", titulo: "Departamento y ciudad" },
  { id: "auditoria", titulo: "Auditoría" },
  { id: "imagenes", titulo: "Auditoría de imágenes" },
  { id: "tableros", titulo: "Tableros" },
  { id: "mantenimiento", titulo: "Mantenimiento" },
  { id: "temas", titulo: "Temas" },
  { id: "usuarios", titulo: "Administradores" },
] as const;

type Seccion = (typeof SECCIONES)[number]["id"];

export default function PanelAdmin() {
  const [activa, setActiva] = useState<Seccion>("cargar");

  return (
    <>
      <nav
        aria-label="Secciones del panel"
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
        {activa === "cargar" && <Cargador />}
        {activa === "editar" && <EditorCartera />}
        {activa === "backoffice" && <BackOffice />}
        {activa === "territorio" && <FiltroTerritorio />}
        {activa === "auditoria" && <Auditoria />}
        {activa === "imagenes" && <AuditoriaImagenes />}
        {activa === "tableros" && <PanelTableros />}
        {activa === "mantenimiento" && <Mantenimiento />}
        {activa === "temas" && <PanelTemas />}
        {activa === "usuarios" && <AdminUsuarios />}
      </div>
    </>
  );
}
