/**
 * Queries guardadas de la Auditoría con query (tabla queries_fotos, en
 * supabase/panel.sql): tipos y limpieza de lo que llega. Lo usan el navegador
 * y las rutas de la API; aquí no se importa nada del servidor.
 */

/** Lo que la pantalla necesita saber de cada fila de la query. */
export const ROLES = ["foto", "fecha", "pdv", "consultor", "codigo"] as const;
export type Rol = (typeof ROLES)[number];

/** Qué columna del resultado hace de cada cosa (null: ninguna). */
export type Mapeo = Record<Rol, string | null>;

export const MAPEO_VACIO: Mapeo = { foto: null, fecha: null, pdv: null, consultor: null, codigo: null };

export const NOMBRE_ROL: Record<Rol, string> = {
  foto: "Foto",
  fecha: "Fecha",
  pdv: "PDV",
  consultor: "Consultor",
  codigo: "Código",
};

export type QueryGuardada = {
  id: number;
  nombre: string;
  sql: string;
  /** Las columnas elegidas al guardarla. Puede faltar alguna. */
  columnas: Partial<Mapeo>;
  actualizado_por: string | null;
  actualizado: string | null;
};

export const MAX_NOMBRE_QUERY = 80;
const MAX_COLUMNA = 120;

/** El nombre de la query, sin espacios de sobra; null si no sirve. */
export function limpiarNombreQuery(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const t = valor.replace(/\s+/g, " ").trim();
  return t && t.length <= MAX_NOMBRE_QUERY ? t : null;
}

/** Solo los roles conocidos, con el nombre de la columna recortado. */
export function limpiarColumnas(valor: unknown): Partial<Mapeo> {
  const salida: Partial<Mapeo> = {};
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return salida;
  const v = valor as Record<string, unknown>;
  for (const rol of ROLES) {
    const c = v[rol];
    if (c === null) salida[rol] = null;
    else if (typeof c === "string" && c.trim()) salida[rol] = c.trim().slice(0, MAX_COLUMNA);
  }
  return salida;
}
