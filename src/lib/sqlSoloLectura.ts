/**
 * Revisión de las queries que se escriben en la Auditoría con query: una sola
 * sentencia y de solo lectura (SELECT o WITH). Corre en el navegador, para
 * avisar mientras se escribe, y en el servidor, que es la revisión que vale:
 * la ruta /api/admin/auditoria-query no manda a Athena nada que no pase por
 * aquí, ni siquiera una query guardada.
 *
 * Es una barrera más, no la única. Lo que de verdad limita lo que se puede
 * hacer en Athena son los permisos del usuario de AWS (ATHENA_ACCESS_KEY_ID):
 * ese usuario debería poder leer y nada más.
 */

export const MAX_SQL = 20_000;

/** Lo que escribe, borra o cambia algo. Nada de esto hace falta en un SELECT. */
const PROHIBIDAS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "DROP",
  "CREATE",
  "ALTER",
  "TRUNCATE",
  "UNLOAD",
  "MSCK",
  "GRANT",
  "REVOKE",
  "CALL",
  "OPTIMIZE",
  "VACUUM",
  "PREPARE",
  "EXECUTE",
  "DEALLOCATE",
]);

export type RevisionSql = { ok: true; sql: string } | { ok: false; error: string };

const mal = (error: string): RevisionSql => ({ ok: false, error });

/**
 * Revisa la query y la devuelve lista para Athena: sin el punto y coma ni los
 * comentarios del final. Los textos entre comillas y los comentarios no
 * cuentan al buscar palabras prohibidas: `WHERE estado = 'DELETE'` sirve.
 */
export function revisarSql(texto: unknown): RevisionSql {
  if (typeof texto !== "string" || !texto.trim()) return mal("Escribe la query.");
  if (texto.length > MAX_SQL) {
    return mal(`La query es muy larga: el máximo es ${MAX_SQL.toLocaleString("es-CO")} caracteres.`);
  }

  // El esqueleto es la query sin comentarios y con cada texto entre comillas
  // cambiado por uno neutro. `ultimo` es el último carácter que cuenta.
  let esqueleto = "";
  let ultimo = -1;
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i];
    const sigue = texto[i + 1];
    if (c === "-" && sigue === "-") {
      const fin = texto.indexOf("\n", i);
      i = fin === -1 ? n : fin;
      esqueleto += " ";
      continue;
    }
    if (c === "/" && sigue === "*") {
      const fin = texto.indexOf("*/", i + 2);
      if (fin === -1) return mal("Hay un comentario /* sin cerrar.");
      i = fin + 2;
      esqueleto += " ";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      // Dentro, la comilla repetida ('' o "") es una comilla escrita.
      let j = i + 1;
      for (;;) {
        const k = texto.indexOf(c, j);
        if (k === -1) {
          return mal(c === "'" ? "Hay una comilla simple sin cerrar." : "Hay un nombre entre comillas sin cerrar.");
        }
        if (texto[k + 1] === c) {
          j = k + 2;
          continue;
        }
        j = k + 1;
        break;
      }
      esqueleto += c === "'" ? " 'x' " : ' "x" ';
      ultimo = j - 1;
      i = j;
      continue;
    }
    esqueleto += c;
    if (c !== ";" && !/\s/.test(c)) ultimo = i;
    i++;
  }

  const cuerpo = esqueleto.replace(/[\s;]+$/, "").trim();
  if (!cuerpo) return mal("Escribe la query: solo hay comentarios.");
  if (cuerpo.includes(";")) return mal("Va una sola query a la vez: quita el punto y coma del medio.");

  const primera = cuerpo.replace(/^[\s(]+/, "").match(/^[\p{L}_]+/u)?.[0]?.toUpperCase();
  if (primera !== "SELECT" && primera !== "WITH") {
    return mal("Solo se permiten queries de lectura: tienen que empezar por SELECT o WITH.");
  }

  for (const palabra of cuerpo.match(/[\p{L}_][\p{L}\p{N}_]*/gu) ?? []) {
    const p = palabra.toUpperCase();
    if (PROHIBIDAS.has(p)) {
      return mal(
        `La query tiene la palabra ${p}, que no se permite aquí. Si es el nombre de una columna, escríbelo entre comillas dobles ("${palabra.toLowerCase()}").`
      );
    }
  }

  // Las funciones de tabla pueden mandar SQL a otras bases (system.query).
  if (/\bTABLE\s*\(/i.test(cuerpo)) return mal("No se permiten funciones de tabla, TABLE(…).");

  return { ok: true, sql: texto.slice(0, ultimo + 1) };
}
