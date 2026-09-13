export type PuntoCartera = {
  id_registro?: number;
  id_pdv: string;
  bavaria: string | null;
  pdv: string | null;
  direccion: string | null;
  persona_hacku: string | null;
  celular: string | null;
  que_hacer: string | null;
  fecha_nacimiento?: string | null;
  ciclo: string;
  departamento: string | null;
  ciudad: string | null;
  estado_v1: string | null;
  fecha_v1: string | null;
  hora_v1: string | null;
  usuario_v1: string | null;
  hacku_estado: string | null;
  hacku_curso: string | null;
  estado_v2: string | null;
  fecha_v2: string | null;
  hora_v2: string | null;
  usuario_v2: string | null;
  estado_v3: string | null;
  fecha_v3: string | null;
  hora_v3: string | null;
  usuario_v3: string | null;
  motivo: string | null;
  motivo_dueno: string | null;
  comentario: string | null;
  duracion_v1: string | null;
  ruta: number | null;
  latitud: number | null;
  longitud: number | null;
  num_de_ruta: number | null;
  persona: string | null;
  ccuser: string;
  usuario: string;
  nom: string | null;
  archivo_origen?: string | null;
  coord_corregida?: boolean;
};

export type RespuestaCartera = {
  puntos: PuntoCartera[];
  vendedor: { usuario: string; nombre: string | null; numDeRuta: number | null };
  sinCoordenadas: number;
};

/**
 * Paleta categórica para la columna RUTA (valores 0-17 en la plantilla).
 * Elegida para que dos rutas vecinas nunca se confundan en pantalla de celular
 * a pleno sol, y para seguir siendo distinguible en visión con deficiencia rojo-verde.
 */
export const COLORES_RUTA = [
  "#1F6F8B", // 0  petróleo
  "#D1495B", // 1  rojo carmín
  "#2A9D5C", // 2  verde
  "#E07B00", // 3  naranja
  "#5B4B9E", // 4  violeta
  "#0B7285", // 5  turquesa oscuro
  "#B5179E", // 6  magenta
  "#7A5C2E", // 7  tierra
  "#3457A6", // 8  azul
  "#8A9B00", // 9  oliva
  "#C0392B", // 10 ladrillo
  "#00806E", // 11 verde azulado
  "#9B2226", // 12 vino
  "#4C6EF5", // 13 azul brillante
  "#AD6800", // 14 ámbar oscuro
  "#5F3DC4", // 15 índigo
  "#1D7874", // 16 jade
  "#6D4C41", // 17 café
];

export function colorDeRuta(ruta: number | null | undefined): string {
  if (ruta === null || ruta === undefined || !Number.isFinite(ruta)) return "#6B7B80";
  return COLORES_RUTA[Math.abs(Math.trunc(ruta)) % COLORES_RUTA.length];
}

/**
 * Frase que hay que escribir para borrar toda la cartera.
 * Vive aquí y no en el route.ts porque Next solo permite exportar handlers
 * y opciones de configuración desde un archivo de ruta.
 */
export const FRASE_PURGA = "ELIMINAR TODA LA CARTERA";

/** Centro por defecto: Bogotá. */
export const CENTRO_BOGOTA: [number, number] = [4.65, -74.09];
