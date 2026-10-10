"use client";

import {
  ChartColumn,
  ClipboardCheck,
  House,
  Image as IconoImagen,
  MapPin,
  Palette,
  Pencil,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  Wrench,
} from "lucide-react";
import type { Rol } from "@/lib/auth";
import type { Modo } from "@/lib/modo";
import PanelShell, { type SeccionPanel } from "./PanelShell";
import Inicio from "./Inicio";
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
import AsistenteIA from "./AsistenteIA";

/** Secciones del panel de administración, en el orden del menú. */
const SECCIONES: SeccionPanel[] = [
  {
    id: "inicio",
    menu: "Inicio",
    grupo: null,
    Icono: House,
    encabezadoPropio: true,
    render: (nav) => <Inicio irA={nav.irA} />,
  },
  {
    id: "cargar",
    menu: "Cargar plantilla",
    grupo: "Cartera",
    Icono: Upload,
    encabezadoPropio: true,
    render: () => <Cargador />,
  },
  {
    id: "editar",
    menu: "Editar cartera",
    grupo: "Cartera",
    Icono: Pencil,
    descripcion:
      "Busca un punto por ID, código Bavaria, nombre, dirección, usuario o cédula para corregirlo. Más abajo puedes borrar la cartera de un ciclo o de un archivo.",
    ancho: "angosto",
    render: () => <EditorCartera />,
  },
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
      "Los enlaces que agregues aquí le aparecen al perfil BackOffice en su sección Tableros. Aquí solo se guarda el enlace: el informe sigue en Power BI con sus permisos, así que quien no tenga acceso allá tampoco lo verá acá.",
    ancho: "angosto",
    render: () => <PanelTableros />,
  },
  {
    id: "asistente",
    menu: "Asistente IA",
    grupo: "Herramientas",
    Icono: Sparkles,
    encabezadoPropio: true,
    render: () => <AsistenteIA />,
  },
  {
    id: "mantenimiento",
    menu: "Mantenimiento",
    grupo: "Configuración",
    Icono: Wrench,
    descripcion:
      "Mientras esté activo, la página de consulta muestra un aviso en vez del formulario y nadie puede consultar su cartera. Este panel sigue funcionando: úsalo para cargar el Excel con calma y ciérralo al terminar.",
    ancho: "angosto",
    render: () => <Mantenimiento />,
  },
  {
    id: "temas",
    menu: "Temas",
    titulo: "Temas de temporada",
    grupo: "Configuración",
    Icono: Palette,
    descripcion:
      "Adornos que aparecen solos en las fechas especiales y se retiran al terminar. Son decoración y nada más: no tapan botones ni cambian cómo se usa la página, y en celular salen más pequeños.",
    ancho: "angosto",
    render: () => <PanelTemas />,
  },
  {
    id: "usuarios",
    menu: "Administradores",
    titulo: "Usuarios del panel",
    grupo: "Configuración",
    Icono: ShieldCheck,
    descripcion:
      "Los administradores manejan toda la cartera y los perfiles BackOffice solo consultan. Al superadministrador únicamente lo puede tocar otro superadministrador.",
    ancho: "angosto",
    render: () => <AdminUsuarios />,
  },
];

export default function PanelAdmin({
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
      panel="admin"
      usuario={usuario}
      rol={rol}
      modo={modo}
      menuOculto={menuOculto}
      secciones={SECCIONES}
      inicial="inicio"
    />
  );
}
