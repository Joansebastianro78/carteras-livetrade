"use client";

import { useMemo } from "react";
import {
  ChartColumn,
  CheckCheck,
  ClipboardCheck,
  House,
  Image as IconoImagen,
  Lock,
  MapPin,
  Palette,
  Pencil,
  Route,
  ShieldCheck,
  Sparkles,
  Upload,
  UserCog,
  Users,
  Wrench,
} from "lucide-react";
import type { IdModulo } from "@/lib/permisos";
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
import VisorTableros from "./VisorTableros";
import AsistenteIA from "./AsistenteIA";
import PanelPerfiles from "./PanelPerfiles";
import HallazgosRevisados from "./HallazgosRevisados";
import GeneradorRutas from "./GeneradorRutas";

/** Una sección del menú y el módulo que hay que tener para verla. */
type Seccion = SeccionPanel & { modulo: IdModulo };

/**
 * Todas las secciones del panel, en el orden del menú. Cada perfil ve solo
 * las de sus módulos (Configuración › Perfiles y permisos).
 */
const SECCIONES: Seccion[] = [
  {
    id: "inicio",
    modulo: "inicio",
    menu: "Inicio",
    grupo: null,
    Icono: House,
    encabezadoPropio: true,
    render: (nav) => <Inicio nav={nav} />,
  },
  {
    id: "cargar",
    modulo: "cargar",
    menu: "Cargar plantilla",
    grupo: "Cartera",
    Icono: Upload,
    encabezadoPropio: true,
    render: () => <Cargador />,
  },
  {
    id: "editar",
    modulo: "editar",
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
    modulo: "consultores",
    menu: "Consultores",
    titulo: "Cartera de un consultor",
    grupo: "Cartera",
    Icono: Users,
    encabezadoPropio: true,
    render: () => <BackOffice />,
  },
  {
    id: "territorio",
    modulo: "territorio",
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
    modulo: "auditoria",
    menu: "Datos",
    titulo: "Auditoría de datos",
    grupo: "Auditorías",
    Icono: ClipboardCheck,
    encabezadoPropio: true,
    render: () => <Auditoria />,
  },
  {
    id: "imagenes",
    modulo: "imagenes",
    menu: "Imágenes",
    titulo: "Auditoría de imágenes",
    grupo: "Auditorías",
    Icono: IconoImagen,
    encabezadoPropio: true,
    render: () => <AuditoriaImagenes />,
  },
  {
    // Lo que se marcó como revisado en la auditoría de datos: lo ve quien ve
    // esa auditoría.
    id: "revisados",
    modulo: "auditoria",
    menu: "Revisados",
    titulo: "Hallazgos revisados",
    grupo: "Auditorías",
    Icono: CheckCheck,
    encabezadoPropio: true,
    render: () => <HallazgosRevisados />,
  },
  // Los tableros tienen dos versiones: quien los administra los agrega y
  // publica; quien solo los ve, ve los publicados.
  {
    id: "tableros",
    modulo: "tableros_admin",
    menu: "Tableros",
    titulo: "Tableros de Power BI",
    grupo: "Reportes",
    Icono: ChartColumn,
    descripcion:
      "Los tableros que publiques aquí les aparecen a los perfiles con «Ver tableros». Aquí solo se guarda el enlace: el informe sigue en Power BI con sus permisos, así que quien no tenga acceso allá tampoco lo verá acá.",
    ancho: "angosto",
    render: () => <PanelTableros />,
  },
  {
    id: "tableros",
    modulo: "tableros",
    menu: "Tableros",
    titulo: "Tableros de Power BI",
    grupo: "Reportes",
    Icono: ChartColumn,
    descripcion:
      "Se abren con tu propia cuenta de Power BI. Si un informe te pide iniciar sesión o dice que no tienes acceso, el permiso se pide allá, no aquí.",
    render: () => <VisorTableros />,
  },
  {
    id: "asistente",
    modulo: "asistente",
    menu: "Asistente IA",
    grupo: "Herramientas",
    Icono: Sparkles,
    encabezadoPropio: true,
    render: () => <AsistenteIA />,
  },
  {
    id: "rutas",
    modulo: "rutas",
    menu: "Generador Rutas",
    grupo: "Herramientas",
    Icono: Route,
    descripcion:
      "Sube un Excel con los puntos, di cuántas personas y cuántos puntos por persona, y se arman las rutas por cercanía. Revísalas en el mapa y descarga el mismo Excel con NUM_RUTA y PERSONA.",
    render: () => <GeneradorRutas />,
  },
  {
    id: "mantenimiento",
    modulo: "mantenimiento",
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
    modulo: "temas",
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
    modulo: "usuarios",
    menu: "Administradores",
    titulo: "Usuarios del panel",
    grupo: "Configuración",
    Icono: ShieldCheck,
    descripcion:
      "Cada usuario tiene un perfil y el perfil decide qué módulos ve: se arman en Perfiles y permisos. Al superadministrador únicamente lo puede tocar otro superadministrador.",
    ancho: "angosto",
    render: () => <AdminUsuarios />,
  },
  {
    id: "perfiles",
    modulo: "perfiles",
    menu: "Perfiles y permisos",
    grupo: "Configuración",
    Icono: UserCog,
    descripcion:
      "Crea perfiles y marca qué módulos ve cada uno. El menú de cada persona muestra solo lo suyo, y el servidor le niega lo demás aunque intente entrar por otro lado.",
    render: (nav) => <PanelPerfiles nav={nav} />,
  },
];

export default function PanelAdmin({
  panel,
  usuario,
  nombrePerfil,
  modulos,
  modo,
  menuOculto,
}: {
  /** Por dónde entró: solo cambia el nombre y el color del panel. */
  panel: "admin" | "backoffice";
  usuario: string;
  nombrePerfil: string;
  modulos: IdModulo[];
  modo: Modo;
  menuOculto: boolean;
}) {
  const secciones = useMemo(() => {
    const tiene = (m: IdModulo) => modulos.includes(m);
    const visibles = SECCIONES.filter((s) => {
      if (!tiene(s.modulo)) return false;
      // Quien administra los tableros no necesita además el visor.
      if (s.modulo === "tableros" && tiene("tableros_admin")) return false;
      return true;
    });

    if (visibles.length > 0) return visibles;

    const vacia: SeccionPanel = {
      id: "sin-modulos",
      menu: "Sin módulos",
      titulo: "Tu perfil todavía no tiene módulos",
      grupo: null,
      Icono: Lock,
      descripcion: `El perfil ${nombrePerfil} no tiene ningún módulo asignado. Pídele a un administrador que te dé permisos en Configuración › Perfiles y permisos y, cuando lo haga, recarga esta página.`,
      ancho: "angosto",
      render: () => null,
    };
    return [vacia];
  }, [modulos, nombrePerfil]);

  return (
    <PanelShell
      panel={panel}
      usuario={usuario}
      nombrePerfil={nombrePerfil}
      modulos={modulos}
      modo={modo}
      menuOculto={menuOculto}
      secciones={secciones}
      inicial={secciones[0].id}
    />
  );
}
