/**
 * Descarga de una foto desde el servidor, para sacarle la huella o
 * mostrársela a la IA. SOLO SERVIDOR.
 *
 * Los enlaces llegan del navegador, así que se cuidan como cualquier dirección
 * ajena: solo http y https, solo los puertos de siempre, nada que apunte a la
 * red interna (127.0.0.1, 10.x, 192.168.x, 169.254.x…), con tope de tamaño y
 * de tiempo, y las redirecciones se revisan una por una con las mismas reglas.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Servidores de la red interna que sí se pueden descargar, como «host:puerto».
 * Vacío en producción; sirve para desarrollo local con un servidor de fotos
 * en la misma máquina.
 */
const INTERNOS_PERMITIDOS: string[] = [];

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SALTOS = 3;

export type Descarga =
  | { ok: true; datos: Buffer }
  /** definitivo: no vale la pena volver a intentarlo (404, no es imagen…). */
  | { ok: false; error: string; definitivo: boolean };

const falla = (error: string, definitivo: boolean): Descarga => ({ ok: false, error, definitivo });

/** Direcciones de la red interna, de la máquina o reservadas. */
export function esDireccionInterna(ip: string): boolean {
  const v = ip.toLowerCase();
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v.startsWith("::ffff:")) return esDireccionInterna(v.slice(7));
  return v === "::" || v === "::1" || /^(fc|fd|fe[89ab]|ff)/.test(v);
}

/** Por qué no se descarga esa dirección, o null si se puede. */
async function revisarDestino(url: URL): Promise<string | null> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "El enlace no es http ni https.";
  if (INTERNOS_PERMITIDOS.includes(url.host)) return null;
  if (url.username || url.password) return "El enlace trae usuario y clave.";
  if (url.port && url.port !== "80" && url.port !== "443") return "El enlace usa un puerto que no se descarga.";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let direcciones: string[];
  try {
    direcciones = isIP(host) ? [host] : (await lookup(host, { all: true })).map((d) => d.address);
  } catch {
    return "No se encontró el servidor de la foto.";
  }
  if (direcciones.length === 0 || direcciones.some(esDireccionInterna)) {
    return "El enlace apunta a una dirección interna y no se descarga.";
  }
  return null;
}

export async function descargarFoto(direccion: string, ms = 15_000): Promise<Descarga> {
  let url: URL;
  try {
    url = new URL(direccion);
  } catch {
    return falla("El enlace no es válido.", true);
  }

  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ms);
  try {
    for (let salto = 0; salto <= MAX_SALTOS; salto++) {
      const motivo = await revisarDestino(url);
      if (motivo) return falla(motivo, true);

      const r = await fetch(url, {
        redirect: "manual",
        signal: control.signal,
        cache: "no-store",
        headers: { Accept: "image/*,*/*;q=0.5" },
      });
      const destino = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && destino) {
        url = new URL(destino, url);
        continue;
      }
      if (!r.ok) {
        return falla(`El servidor de fotos respondió ${r.status}.`, [400, 401, 403, 404, 410].includes(r.status));
      }
      const tipo = (r.headers.get("content-type") ?? "").toLowerCase();
      if (tipo && !/^(image\/|application\/octet-stream|binary\/)/.test(tipo)) {
        return falla("El enlace no lleva a una imagen.", true);
      }
      if (Number(r.headers.get("content-length")) > MAX_BYTES) return falla("La foto pesa más de 20 MB.", true);

      const trozos: Uint8Array[] = [];
      let total = 0;
      const lector = r.body?.getReader();
      if (!lector) return falla("La foto llegó vacía.", true);
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await lector.cancel().catch(() => {});
          return falla("La foto pesa más de 20 MB.", true);
        }
        trozos.push(value);
      }
      if (total === 0) return falla("La foto llegó vacía.", true);
      return { ok: true, datos: Buffer.concat(trozos) };
    }
    return falla("El enlace redirige demasiadas veces.", true);
  } catch {
    return falla(control.signal.aborted ? "La foto tardó demasiado en descargar." : "No se pudo descargar la foto.", false);
  } finally {
    clearTimeout(reloj);
  }
}
