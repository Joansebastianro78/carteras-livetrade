import { NextResponse } from "next/server";
import { crearRutaAthena } from "@/lib/rutaAthena";
import { sesionConPermisos } from "@/lib/perfilesServidor";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { esTablaFaltante, textoError } from "@/lib/tablaFaltante";
import { revisarSql } from "@/lib/sqlSoloLectura";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Auditoría con query: corre en Athena la query que se pide. Ver
 * lib/rutaAthena.ts para el estado y las páginas de resultados.
 *
 *   POST { query: id }  → una query guardada (tabla queries_fotos). Basta con
 *                         «Auditoría con query».
 *   POST { sql }        → la query escrita en la pantalla, guardada o no.
 *                         Pide «Escribir queries».
 *
 * En los dos casos el SQL pasa por revisarSql (una sola sentencia, de solo
 * lectura) antes de ir a Athena, también el que ya estaba guardado.
 */

const json = (error: string, status: number) => NextResponse.json({ error }, { status });

const ruta = crearRutaAthena("fotos-query", async (cuerpo) => {
  const sesion = await sesionConPermisos();
  if (!sesion) return json("Sesión no válida o expirada.", 401);

  if (cuerpo.sql !== undefined) {
    if (!sesion.modulos.includes("fotos_query_sql")) {
      return json("Tu perfil puede correr las queries guardadas, pero no escribir SQL: le falta «Escribir queries».", 403);
    }
    const revision = revisarSql(cuerpo.sql);
    if (!revision.ok) return json(revision.error, 400);
    console.info(`[athena fotos-query] ${sesion.usuario} corre una query escrita (${revision.sql.length} caracteres)`);
    return revision.sql;
  }

  const id = Number(cuerpo.query);
  if (!Number.isSafeInteger(id) || id <= 0) return json("Elige la query que quieres correr.", 400);

  const { data, error, status } = await supabaseAdmin
    .from("queries_fotos")
    .select("nombre,sql")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[athena fotos-query leer]", textoError(error, status));
    return esTablaFaltante(error, status)
      ? json("Falta la tabla queries_fotos. Ejecuta supabase/panel.sql en el SQL Editor.", 503)
      : json("No se pudo leer la query guardada.", 500);
  }
  if (!data) return json("Esa query ya no existe. Recarga la página para ver la lista al día.", 404);

  const revision = revisarSql(data.sql);
  if (!revision.ok) return json(`La query «${data.nombre}» no se puede correr: ${revision.error}`, 400);
  console.info(`[athena fotos-query] ${sesion.usuario} corre «${data.nombre}» (id ${id})`);
  return revision.sql;
});

export const POST = ruta.POST;
export const GET = ruta.GET;
