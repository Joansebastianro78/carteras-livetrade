/**
 * Sesión de administrador: cookie httpOnly firmada con HMAC-SHA256.
 * Usa Web Crypto para que funcione también en el runtime Edge (middleware).
 *
 * Formato del token: "<usuarioB64>.<rolB64>.<expiraEnMs>.<firma>"
 * El usuario y el rol viajan en claro dentro de la cookie, pero van firmados:
 * si alguien los edita, la firma deja de coincidir y la sesión se rechaza.
 */

export const COOKIE_ADMIN = "cartera_admin";
const DURACION_MS = 8 * 60 * 60 * 1000; // 8 horas

/**
 * superadmin: panel completo y, además, el único que puede tocar a otro
 *             superadministrador (desactivarlo, cambiarle clave o perfil).
 * admin:      panel completo sobre la cartera y sobre los demás usuarios.
 * backoffice: solo consulta la cartera de un vendedor.
 */
export type Rol = "admin" | "backoffice" | "superadmin";

export type Sesion = { usuario: string; rol: Rol; expira: number };

export function esRol(valor: string | null | undefined): Rol {
  if (valor === "backoffice") return "backoffice";
  if (valor === "superadmin") return "superadmin";
  return "admin";
}

/** Los dos perfiles que entran al panel de administración. */
export function mandaEnElPanel(rol: Rol): boolean {
  return rol === "admin" || rol === "superadmin";
}

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

export async function crearToken(
  secreto: string,
  usuario: string,
  rol: Rol = "admin"
): Promise<string> {
  const payload = [
    b64urlDesdeTexto(usuario),
    b64urlDesdeTexto(rol),
    Date.now() + DURACION_MS,
  ].join(".");
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

  // Tokens viejos (antes de los roles) traían solo usuario y vencimiento.
  // Se siguen aceptando como admin hasta que expiren, para no botar sesiones.
  const partes = payload.split(".");
  const [usuarioB64, rolB64, expiraTxt] =
    partes.length === 3 ? partes : [partes[0], null, partes[1]];

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
  if (!usuario) return null;

  return {
    usuario,
    rol: esRol(rolB64 ? textoDesdeB64url(rolB64) : null),
    expira,
  };
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
