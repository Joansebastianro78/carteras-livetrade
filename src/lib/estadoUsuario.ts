import { esRol, type Rol } from "./auth";

/**
 * Cómo está hoy un usuario del panel en la base: su perfil, los módulos de
 * ese perfil y si sigue activo.
 *
 * La cookie de sesión dura 8 horas y lleva el perfil adentro. Sin esta
 * consulta, a alguien que le quitan el perfil de administrador (o lo
 * desactivan) le seguía sirviendo su sesión hasta que venciera. El middleware
 * lo revisa en cada petición, con una memoria corta para no consultar la base
 * a cada rato: un cambio tarda como mucho medio minuto en aplicarse.
 *
 * La memoria solo sirve para dejar pasar. Antes de sacar a alguien o de
 * negarle algo, el middleware vuelve a preguntar con { fresco: true }: así, a
 * quien reactivan, le cambian el perfil o le dan un permiso, no lo frena un
 * dato viejo.
 *
 * Usa fetch contra la API REST de Supabase porque el middleware corre en el
 * runtime Edge. Va con la service_role key: solo se usa en el servidor.
 */

/**
 * null: el usuario no existe o está desactivado.
 * modulos null: no se pudieron leer (falta supabase/perfiles.sql) y valen los
 * de siempre de su perfil.
 */
export type EstadoUsuario = { rol: Rol; modulos: string[] | null } | null | "desconocido";

type Fila = {
  rol: string | null;
  activo: boolean;
  perfiles?: { modulos: string[] | null } | null;
};

const MEMORIA_MS = 30_000;
const memoria = new Map<string, { valor: EstadoUsuario; hasta: number }>();

export async function estadoEnBase(
  usuario: string,
  { fresco = false }: { fresco?: boolean } = {}
): Promise<EstadoUsuario> {
  const ahora = Date.now();
  const guardado = memoria.get(usuario);
  if (!fresco && guardado && guardado.hasta > ahora) return guardado.valor;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !llave) return "desconocido";

  // Si la base tarda más de 4 s, se sigue con la cookie. AbortController y no
  // AbortSignal.timeout, que no está en todos los runtimes Edge.
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), 4000);

  const pedir = (campos: string) =>
    fetch(`${url}/rest/v1/admins?select=${campos}&usuario=eq.${encodeURIComponent(usuario)}`, {
      headers: { apikey: llave, Authorization: `Bearer ${llave}` },
      cache: "no-store",
      signal: control.signal,
    });

  try {
    // El perfil viene pegado al usuario por la llave admins.rol → perfiles.
    let res = await pedir("rol,activo,perfiles(modulos)");
    let conPerfiles = true;

    // Sin perfiles.sql no existe esa relación y PostgREST responde 400: se
    // pregunta sin ella y valen los permisos de siempre.
    if (res.status === 400) {
      res = await pedir("rol,activo");
      conPerfiles = false;
    }

    // Sin roles.sql la columna rol no existe y PostgREST responde 400. En ese
    // caso, o si la base no contesta, se sigue con lo que dice la cookie: es
    // como funcionaba antes y no deja a nadie por fuera por un problema ajeno.
    if (!res.ok) return "desconocido";

    const filas = (await res.json()) as Fila[];
    const fila = filas[0];
    const valor: EstadoUsuario =
      !fila || !fila.activo
        ? null
        : {
            rol: esRol(fila.rol),
            modulos: conPerfiles && fila.perfiles ? (fila.perfiles.modulos ?? []) : null,
          };

    if (memoria.size > 500) memoria.clear();
    memoria.set(usuario, { valor, hasta: ahora + MEMORIA_MS });
    return valor;
  } catch {
    return "desconocido";
  } finally {
    clearTimeout(reloj);
  }
}
