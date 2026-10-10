"use client";

import { ChartColumn, ClipboardCheck, Image as IconoImagen, MapPin, Users } from "lucide-react";
import type { Rol } from "@/lib/auth";
import type { Modo } from "@/lib/modo";
import PanelShell, { type SeccionPanel } from "./PanelShell";
import Auditoria from "./Auditoria";
import AuditoriaImagenes from "./AuditoriaImagenes";
import BackOffice from "./BackOffice";
import FiltroTerritorio from "./FiltroTerritorio";
import VisorTableros from "./VisorTableros";

/** Secciones del BackOffice, en el orden del menú. */
const SECCIONES: SeccionPanel[] = [
  {
    id: "consultores",
    menu: "Consultores",
    titulo: "Cartera de un consultor",
    grupo: "Cartera",
    Icono: Users,
    encabezadoPropio: true,
    render: () => <BackOffice />,
  },
  {
    id: "territorio",
    menu: "Departamento y ciudad",
    titulo: "Puntos por departamento y ciudad",
    grupo: "Cartera",
    Icono: MapPin,
    descripcion:
      "Filtra todos los puntos por departamento o ciudad y descárgalos en Excel con las columnas de la plantilla.",
    render: () => <FiltroTerritorio />,
  },
  {
    id: "auditoria",
    menu: "Datos",
    titulo: "Auditoría de datos",
    grupo: "Auditorías",
    Icono: ClipboardCheck,
    encabezadoPropio: true,
    render: () => <Auditoria />,
  },
  {
    id: "imagenes",
    menu: "Imágenes",
    titulo: "Auditoría de imágenes",
    grupo: "Auditorías",
    Icono: IconoImagen,
    encabezadoPropio: true,
    render: () => <AuditoriaImagenes />,
  },
  {
    id: "tableros",
    menu: "Tableros",
    titulo: "Tableros de Power BI",
    grupo: "Reportes",
    Icono: ChartColumn,
    descripcion:
      "Se abren con tu propia cuenta de Power BI. Si un informe te pide iniciar sesión o dice que no tienes acceso, el permiso se pide allá, no aquí.",
    render: () => <VisorTableros />,
  },
];

export default function PanelBackOffice({
  usuario,
  rol,
  modo,
  menuOculto,
}: {
  usuario: string;
  rol: Rol;
  modo: Modo;
  menuOculto: boolean;
}) {
  return (
    <PanelShell
      panel="backoffice"
      usuario={usuario}
      rol={rol}
      modo={modo}
      menuOculto={menuOculto}
      secciones={SECCIONES}
      inicial="consultores"
    />
  );
}
