/**
 * Módulos del panel y qué puede ver cada perfil.
 *
 * Cada perfil (tabla perfiles, supabase/perfiles.sql) guarda la lista de
 * módulos que ve. El menú solo muestra esos y el middleware bloquea las rutas
 * de API de los demás: los permisos no dependen de que la pantalla esconda
 * botones.
 *
 * Sirve en el navegador, en el servidor y en el middleware (runtime Edge):
 * aquí no se importa nada del servidor.
 */

export type IdModulo =
  | "inicio"
  | "cargar"
  | "editar"
  | "consultores"
  | "territorio"
  | "auditoria"
  | "imagenes"
  | "tableros"
  | "tableros_admin"
  | "asistente"
  | "mantenimiento"
  | "temas"
  | "usuarios"
  | "perfiles";

export type Modulo = {
  id: IdModulo;
  nombre: string;
  grupo: string;
  detalle: string;
};

/** El catálogo, en el orden en que sale en la pantalla de perfiles. */
export const MODULOS: Modulo[] = [
  { id: "inicio", nombre: "Inicio", grupo: "General", detalle: "Cifras de la cartera, actividad reciente y lo que hay para revisar." },
  { id: "cargar", nombre: "Cargar plantilla", grupo: "Cartera", detalle: "Subir el Excel de la cartera: crear, actualizar o agregar puntos." },
  { id: "editar", nombre: "Editar cartera", grupo: "Cartera", detalle: "Corregir o borrar puntos, y borrar la cartera de un ciclo o de un archivo." },
  { id: "consultores", nombre: "Consultores", grupo: "Cartera", detalle: "Ver la cartera de un consultor con su mapa y descargarla." },
  { id: "territorio", nombre: "Departamento y ciudad", grupo: "Cartera", detalle: "Filtrar los puntos por región y bajarlos en Excel." },
  { id: "auditoria", nombre: "Auditoría de datos", grupo: "Auditorías", detalle: "Hallazgos de los formularios, el Excel limpio y marcarlos como revisados." },
  { id: "imagenes", nombre: "Auditoría de imágenes", grupo: "Auditorías", detalle: "Fotos de inicio de visita y marcarlas como correctas o para revisar." },
  { id: "tableros", nombre: "Ver tableros", grupo: "Reportes", detalle: "Los tableros de Power BI publicados." },
  { id: "tableros_admin", nombre: "Administrar tableros", grupo: "Reportes", detalle: "Agregar, editar, publicar u ocultar tableros de Power BI." },
  { id: "asistente", nombre: "Asistente IA", grupo: "Herramientas", detalle: "Chat con Gemini y DeepSeek, con imágenes y documentos." },
  { id: "mantenimiento", nombre: "Mantenimiento", grupo: "Configuración", detalle: "Cerrar y abrir la página de consulta de los consultores." },
  { id: "temas", nombre: "Temas", grupo: "Configuración", detalle: "Adornos de temporada de la página." },
  { id: "usuarios", nombre: "Administradores", grupo: "Configuración", detalle: "Crear usuarios del panel, cambiarles la clave o el perfil y desactivarlos. Solo puede dar perfiles con permisos que él también tenga." },
  { id: "perfiles", nombre: "Perfiles y permisos", grupo: "Configuración", detalle: "Crear perfiles y decidir qué módulos ve cada uno. Solo puede dar o quitar permisos que él también tenga." },
];

export const IDS_MODULOS: IdModulo[] = MODULOS.map((m) => m.id);

export function esModulo(valor: unknown): valor is IdModulo {
  return typeof valor === "string" && (IDS_MODULOS as string[]).includes(valor);
}

/** El perfil que siempre lo ve todo y no se puede editar. */
export const SUPERADMIN = "superadmin";

/** Los tres perfiles de siempre, por si todavía no existe la tabla perfiles. */
export const PERFILES_BASE: { clave: string; nombre: string; descripcion: string; modulos: IdModulo[] }[] = [
  {
    clave: "superadmin",
    nombre: "Superadministrador",
    descripcion: "Todo el panel. Es el único que puede tocar a otro superadministrador.",
    modulos: IDS_MODULOS,
  },
  {
    clave: "admin",
    nombre: "Administrador",
    descripcion: "Maneja toda la cartera, los usuarios y la configuración.",
    modulos: IDS_MODULOS,
  },
  {
    clave: "backoffice",
    nombre: "BackOffice",
    descripcion: "Consulta: la cartera de un consultor, las regiones, las auditorías y los tableros.",
    modulos: ["consultores", "territorio", "auditoria", "imagenes", "tableros", "asistente"],
  },
];

/**
 * Los módulos que de verdad tiene un perfil. El superadministrador los tiene
 * todos, también los que se agreguen en el futuro. Con `guardados` en null
 * (no se pudo leer la base, o falta perfiles.sql) valen los de siempre.
 */
export function modulosEfectivos(rol: string, guardados: readonly string[] | null): IdModulo[] {
  if (rol === SUPERADMIN) return IDS_MODULOS;
  if (guardados) return IDS_MODULOS.filter((m) => guardados.includes(m));
  return PERFILES_BASE.find((p) => p.clave === rol)?.modulos ?? [];
}

/**
 * Qué módulo pide cada ruta de API. "libre": cualquiera con sesión.
 * Una ruta que no esté aquí solo la usa el superadministrador: si mañana se
 * agrega una y nadie la registra, queda cerrada en vez de abierta.
 */
export function modulosDeRuta(
  pathname: string,
  metodo: string,
  parametros?: URLSearchParams
): "libre" | IdModulo[] | null {
  const es = (prefijo: string) => pathname === prefijo || pathname.startsWith(prefijo + "/");
  const lectura = metodo === "GET" || metodo === "HEAD";

  if (es("/api/admin/login") || es("/api/admin/logout")) return "libre";
  if (es("/api/admin/resumen")) {
    if (!lectura) return null;
    // Mismo orden que la ruta: primero ?lista=, después ?corto=.
    // Las listas son puntos de la cartera para descargar, desde el Inicio.
    if (parametros?.get("lista")) return ["inicio"];
    // La barra de arriba del panel (ciclo y mantenimiento): la ve todo el mundo.
    if (parametros?.get("corto")) return "libre";
    // Las cifras de la cartera: el Inicio y la pantalla de cargar.
    return ["inicio", "cargar"];
  }
  if (es("/api/admin/actividad")) return ["inicio"];
  if (es("/api/admin/upload")) return ["cargar"];
  if (es("/api/admin/puntos") || es("/api/admin/purgar")) return ["editar"];
  if (es("/api/admin/consultores") || es("/api/admin/vendedores")) return ["consultores"];
  if (es("/api/admin/territorio")) return ["territorio"];
  if (es("/api/admin/auditoria-imagenes") || es("/api/admin/revision-fotos")) return ["imagenes"];
  if (es("/api/admin/revision-hallazgos")) return ["auditoria"];
  if (es("/api/admin/auditoria")) return ["auditoria"];
  if (es("/api/admin/tableros")) return lectura ? ["tableros", "tableros_admin"] : ["tableros_admin"];
  // Análisis de tableros con Gemini: era solo de administradores y así sigue.
  if (es("/api/admin/analisis")) return ["tableros_admin"];
  if (es("/api/admin/asistente")) return ["asistente"];
  if (es("/api/admin/mantenimiento")) return ["mantenimiento"];
  if (es("/api/admin/tema")) return ["temas"];
  if (es("/api/admin/usuarios")) return ["usuarios"];
  if (es("/api/admin/perfiles")) return ["perfiles"];
  return null;
}

/** Si con esos módulos se puede usar la ruta. */
export function puedeUsarRuta(
  modulos: readonly IdModulo[],
  rol: string,
  pathname: string,
  metodo: string,
  parametros?: URLSearchParams
): boolean {
  const regla = modulosDeRuta(pathname, metodo, parametros);
  if (regla === "libre") return true;
  if (rol === SUPERADMIN) return true;
  if (!regla) return false;
  return regla.some((m) => modulos.includes(m));
}

/**
 * Si quien tiene `mios` puede dar (o quitar) un perfil con `otros`: solo si
 * ya tiene todos esos módulos. Así nadie arma un perfil, ni crea un usuario,
 * con más permisos que los suyos. El superadministrador puede todo.
 */
export function cubre(rol: string, mios: readonly IdModulo[], otros: readonly string[]): boolean {
  if (rol === SUPERADMIN) return true;
  return otros.every((m) => !esModulo(m) || mios.includes(m));
}

/** Convierte un nombre en la clave del perfil: «Analista de Bogotá» → analista-de-bogota. */
export function claveDePerfil(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
