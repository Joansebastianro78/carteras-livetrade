/**
 * Filtro de la cartera por departamento y ciudad (perfil BackOffice).
 *
 * Archivo puro, sin Supabase: lo usan la ruta /api/admin/territorio y el
 * navegador (pantalla y descarga en Excel).
 */

/**
 * Valor que viaja en la URL para "sin departamento", "sin ciudad" o el ciclo
 * vacío. Va aparte de "" porque "" en un select significa "sin filtro".
 */
export const SIN_DATO = "~";

/** Valor del filtro para traer los puntos de todos los departamentos. */
export const TODOS_LOS_DEPARTAMENTOS = "*";

/**
 * Cómo se agrupan los puntos en el desglose y en los colores del mapa: por
 * departamento cuando se piden todos, por ciudad cuando se pide uno.
 */
export type Agrupacion = "departamento" | "ciudad";

/** Lo que trae cada punto en este módulo: las columnas azules y lo que pide el mapa. */
export type PuntoTerritorio = {
  id_registro: number;
  id_pdv: string;
  bavaria: string | null;
  pdv: string | null;
  direccion: string | null;
  persona_hacku: string | null;
  celular: string | null;
  que_hacer: string | null;
  fecha_nacimiento: string | null;
  ciclo: string;
  departamento: string | null;
  ciudad: string | null;
  estado_v1: string | null;
  fecha_v1: string | null;
  hacku_estado: string | null;
  hacku_curso: string | null;
  estado_v2: string | null;
  fecha_v2: string | null;
  estado_v3: string | null;
  fecha_v3: string | null;
  hora_v3: string | null;
  usuario_v3: string | null;
  motivo: string | null;
  motivo_dueno: string | null;
  comentario: string | null;
  ccuser: string;
  usuario: string;
  nom: string | null;
  latitud: number | null;
  longitud: number | null;
  departamento_clave: string | null;
  ciudad_clave: string | null;
};

export type ColumnaExcel = {
  /** Encabezado tal cual está en la plantilla. */
  encabezado: string;
  campo: keyof PuntoTerritorio;
  /** Las fechas se escriben como fecha de Excel, no como texto. */
  tipo?: "fecha";
  ancho: number;
};

/**
 * Columnas del Excel que se descarga desde este módulo: exactamente las que
 * tienen el encabezado en azul (#00B0F0) en PLANTILLA_CARGA_MASIVA.xlsx, en el
 * mismo orden y con el mismo nombre. Si cambia el color en la plantilla, se
 * cambia esta lista y nada más.
 *
 * Quedan fuera, porque en la plantilla no están en azul: ID, HORA V1,
 * USUARIO V1, HORA V2, USUSARIO V2, DURACION V1, RUTA, LATITUD, LONGITUD,
 * num de ruta y persona.
 */
export const COLUMNAS_EXCEL_TERRITORIO: ColumnaExcel[] = [
  { encabezado: "BAVARIA", campo: "bavaria", ancho: 12 },
  { encabezado: "PDV", campo: "pdv", ancho: 36 },
  { encabezado: "DIRECCION", campo: "direccion", ancho: 40 },
  { encabezado: "PERSONA HACKU", campo: "persona_hacku", ancho: 28 },
  { encabezado: "CELULAR", campo: "celular", ancho: 15 },
  { encabezado: "QUE HACER", campo: "que_hacer", ancho: 16 },
  { encabezado: "FECHA_NACIMIENTO", campo: "fecha_nacimiento", tipo: "fecha", ancho: 18 },
  { encabezado: "CICLO", campo: "ciclo", ancho: 10 },
  { encabezado: "DEPARTAMENTO", campo: "departamento", ancho: 18 },
  { encabezado: "CIUDAD", campo: "ciudad", ancho: 18 },
  { encabezado: "ESTADO V1", campo: "estado_v1", ancho: 14 },
  { encabezado: "FECHA V1", campo: "fecha_v1", tipo: "fecha", ancho: 12 },
  { encabezado: "HACKU ESTADO", campo: "hacku_estado", ancho: 15 },
  { encabezado: "HACKU CURSO", campo: "hacku_curso", ancho: 15 },
  { encabezado: "ESTADO V2", campo: "estado_v2", ancho: 14 },
  { encabezado: "FECHA V2", campo: "fecha_v2", tipo: "fecha", ancho: 12 },
  { encabezado: "ESTADO V3", campo: "estado_v3", ancho: 14 },
  { encabezado: "FECHA V3", campo: "fecha_v3", tipo: "fecha", ancho: 12 },
  { encabezado: "HORA V3", campo: "hora_v3", ancho: 10 },
  { encabezado: "USUARIO V3", campo: "usuario_v3", ancho: 14 },
  { encabezado: "MOTIVO", campo: "motivo", ancho: 24 },
  { encabezado: "MOTIVO DUEÑO", campo: "motivo_dueno", ancho: 24 },
  { encabezado: "COMENTARIO", campo: "comentario", ancho: 34 },
  { encabezado: "ccuser", campo: "ccuser", ancho: 14 },
  { encabezado: "user", campo: "usuario", ancho: 12 },
  { encabezado: "nom", campo: "nom", ancho: 28 },
];

/** Columnas que pide la ruta a Supabase: las del Excel más las del mapa. */
export const CAMPOS_TERRITORIO = [
  ...new Set<string>([
    "id_registro",
    "id_pdv",
    ...COLUMNAS_EXCEL_TERRITORIO.map((c) => c.campo),
    "latitud",
    "longitud",
    "departamento_clave",
    "ciudad_clave",
  ]),
].join(",");

export type CiudadResumen = { clave: string; nombre: string; puntos: number };

export type DepartamentoResumen = {
  clave: string;
  nombre: string;
  puntos: number;
  ciudades: CiudadResumen[];
};

export type RespuestaResumenTerritorio = {
  departamentos: DepartamentoResumen[];
  ciclos: string[];
};

export type RespuestaPuntosTerritorio = {
  puntos: PuntoTerritorio[];
  total: number;
  /** Desde dónde pedir la siguiente página, o null si ya no hay más. */
  siguiente: number | null;
};

/**
 * Punto elegido y desde dónde. Importa para el mapa: si se tocó en el mapa,
 * Leaflet ya abrió el globo y acomodó la vista; si se eligió en la lista, el
 * mapa tiene que ir hasta el punto y abrirlo.
 */
export type SeleccionPunto = { id: number; desde: "lista" | "mapa" };

export function claveGrupo(p: PuntoTerritorio, por: Agrupacion): string {
  return (por === "departamento" ? p.departamento_clave : p.ciudad_clave) ?? SIN_DATO;
}

export function nombreDepartamento(nombre: string | null | undefined): string {
  return nombre?.trim() || "Sin departamento";
}

export function nombreCiudad(nombre: string | null | undefined): string {
  return nombre?.trim() || "Sin ciudad";
}
