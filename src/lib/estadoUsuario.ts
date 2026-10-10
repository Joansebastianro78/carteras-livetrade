import { esRol, type Rol } from "./auth";

/**
 * Cómo está hoy un usuario del panel en la base: su perfil y si sigue activo.
 *
 * La cookie de sesión dura 8 horas y lleva el perfil adentro. Sin esta
 * consulta, a alguien que le quitan el perfil de administrador (o lo
 * desactivan) le seguía sirviendo su sesión hasta que venciera. El middleware
 * lo revisa en cada petición, con una memoria corta para no consultar la base
 * a cada rato: un cambio tarda como mucho medio minuto en aplicarse.
 *
 * La memoria solo sirve para dejar pasar. Antes de sacar a alguien, el
 * middleware vuelve a preguntar con { fresco: true }: así, a quien reactivan
 * o le cambian el perfil y entra de nuevo enseguida, no lo saca un dato viejo.
 *
 * Usa fetch contra la API REST de Supabase porque el middleware corre en el
 * runtime Edge. Va con la service_role key: solo se usa en el servidor.
 */

/** null: el usuario no existe o está desactivado. */
export type EstadoUsuario = { rol: Rol } | null | "desconocido";

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

  try {
    const res = await fetch(
      `${url}/rest/v1/admins?select=rol,activo&usuario=eq.${encodeURIComponent(usuario)}`,
      {
        headers: { apikey: llave, Authorization: `Bearer ${llave}` },
        cache: "no-store",
        signal: control.signal,
      }
    );

    // Sin roles.sql la columna rol no existe y PostgREST responde 400. En ese
    // caso, o si la base no contesta, se sigue con lo que dice la cookie: es
    // como funcionaba antes y no deja a nadie por fuera por un problema ajeno.
    if (!res.ok) return "desconocido";

    const filas = (await res.json()) as { rol: string | null; activo: boolean }[];
    const valor: EstadoUsuario =
      filas.length === 0 || !filas[0].activo ? null : { rol: esRol(filas[0].rol) };

    if (memoria.size > 500) memoria.clear();
    memoria.set(usuario, { valor, hasta: ahora + MEMORIA_MS });
    return valor;
  } catch {
    return "desconocido";
  } finally {
    clearTimeout(reloj);
  }
}
