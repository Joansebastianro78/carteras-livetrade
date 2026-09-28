/**
 * Tableros de Power BI.
 *
 * Solo se guarda el enlace. El informe sigue viviendo en Power BI con sus
 * permisos: si alguien no tiene acceso allá, tampoco lo verá acá aunque le
 * aparezca el tablero en la lista.
 *
 * Archivo puro, sin Supabase: lo usan el navegador y el servidor.
 */

export type Tablero = {
  id: string;
  nombre: string;
  descripcion: string | null;
  url: string;
  orden: number;
  activo: boolean;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Solo se aceptan enlaces de Power BI. No es un capricho: un <iframe> corre
 * dentro de nuestra página, así que dejar cualquier dominio sería abrirle la
 * puerta a que alguien monte ahí una pantalla falsa de inicio de sesión.
 */
export const DOMINIOS_PERMITIDOS = [
  "app.powerbi.com",
  "app.powerbigov.us",
  "msit.powerbi.com",
];

/**
 * Acepta tanto el enlace pelado como el <iframe ...> que Power BI entrega al
 * darle "Insertar informe", porque es lo que la gente copia de verdad.
 * Devuelve la URL limpia o null si no sirve.
 */
export function normalizarUrlTablero(entrada: string): string | null {
  const texto = (entrada ?? "").trim();
  if (!texto) return null;

  // Si pegaron el fragmento HTML completo, se le saca el src.
  const enIframe = texto.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
  const candidato = enIframe ? enIframe[1] : texto;

  let url: URL;
  try {
    url = new URL(candidato);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;

  const dominio = url.hostname.toLowerCase();
  const permitido = DOMINIOS_PERMITIDOS.some(
    (d) => dominio === d || dominio.endsWith(`.${d}`)
  );
  if (!permitido) return null;

  return url.toString();
}

/** Para abrir el informe en Power BI en una pestaña aparte. */
export function esEnlaceIncrustado(url: string): boolean {
  return /\/reportEmbed/i.test(url);
}
