/**
 * Sesión de administrador: cookie httpOnly firmada con HMAC-SHA256.
 * Usa Web Crypto para que funcione también en el runtime Edge (middleware).
 *
 * Formato del token: "<usuarioB64>.<expiraEnMs>.<firma>"
 * El usuario viaja en claro dentro de la cookie, pero va firmado: si alguien
 * SSlo edita, la firma deja de coincidir y la sesión se rechaza.
 */

export const COOKIE_ADMIN = "cartera_admin";
const DURACION_MS = 8 * 60 * 60 * 1000; // 8 horas

export type Sesion = { usuario: string; expira: number };

function b64urlDesdeBytes(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDesdeTexto(texto: string): string {
  return b64urlDesdeBytes(new TextEncoder().encode(texto));
}

function textoDesdeB64url(s: string): string | null {
  try {
    const base = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(base + "=".repeat((4 - (base.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function clave(secreto: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function firmar(payload: string, secreto: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    "HMAC",
    await clave(secreto),
    new TextEncoder().encode(payload)
  );
  return b64urlDesdeBytes(sig);
}

export async function crearToken(secreto: string, usuario: string): Promise<string> {
  const payload = `${b64urlDesdeTexto(usuario)}.${Date.now() + DURACION_MS}`;
  return `${payload}.${await firmar(payload, secreto)}`;
}

/** Devuelve la sesión si el token es válido y no expiró; null en cualquier otro caso. */
export async function leerSesion(
  token: string | undefined,
  secreto: string | undefined
): Promise<Sesion | null> {
  if (!token || !secreto) return null;

  const corte = token.lastIndexOf(".");
  if (corte <= 0) return null;

  const payload = token.slice(0, corte);
  const firma = token.slice(corte + 1);

  const [usuarioB64, expiraTxt] = payload.split(".");
  if (!usuarioB64 || !expiraTxt || !/^\d+$/.test(expiraTxt)) return null;

  const expira = Number(expiraTxt);
  if (expira < Date.now()) return null;

  const esperada = await firmar(payload, secreto);
  if (esperada.length !== firma.length) return null;

  // Comparación en tiempo constante
  let diff = 0;
  for (let i = 0; i < esperada.length; i++) {
    diff |= esperada.charCodeAt(i) ^ firma.charCodeAt(i);
  }
  if (diff !== 0) return null;

  const usuario = textoDesdeB64url(usuarioB64);
  return usuario ? { usuario, expira } : null;
}

export async function tokenValido(
  token: string | undefined,
  secreto: string | undefined
): Promise<boolean> {
  return (await leerSesion(token, secreto)) !== null;
}

export const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: DURACION_MS / 1000,
};
