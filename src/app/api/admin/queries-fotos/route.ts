import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sesionConPermisos } from "@/lib/perfilesServidor";
import { registrarActividad } from "@/lib/actividad";
import { esTablaFaltante, textoError } from "@/lib/tablaFaltante";
import { revisarSql } from "@/lib/sqlSoloLectura";
import {
  MAX_NOMBRE_QUERY,
  limpiarColumnas,
  limpiarNombreQuery,
  type QueryGuardada,
} from "@/lib/queriesFotos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Queries guardadas de la Auditoría con query (tabla queries_fotos, en
 * supabase/panel.sql).
 *
 *   GET                                   → la lista; la ven «Auditoría con
 *                                           query» y «Escribir queries»
 *   POST   { nombre, sql, columnas }      → guarda una nueva
 *   PATCH  { id, nombre, sql, columnas }  → la cambia
 *   DELETE ?id=X                          → la borra
 *
 * Guardar, cambiar y borrar piden «Escribir queries». El middleware ya lo
 * revisa; aquí se vuelve a revisar para que la regla no dependa de él.
 * El SQL se revisa al guardar (lib/sqlSoloLectura.ts) y otra vez al correrlo.
 */

const AVISO_SIN_TABLA =
  "Para guardar queries falta la tabla queries_fotos. Ejecuta supabase/panel.sql en el SQL Editor.";

const COLUMNAS = "id,nombre,sql,columnas,actualizado_por,updated_at";

type FilaQuery = {
  id: number;
  nombre: string;
  sql: string;
  columnas: unknown;
  actualizado_por: string | null;
  updated_at: string | null;
};

function aQuery(f: FilaQuery): QueryGuardada {
  return {
    id: f.id,
    nombre: f.nombre,
    sql: f.sql,
    columnas: limpiarColumnas(f.columnas),
    actualizado_por: f.actualizado_por,
    actualizado: f.updated_at,
  };
}

function falla(paso: string, error: { message?: string; code?: string }, status: number, mensaje: string) {
  console.error(`[queries-fotos ${paso}]`, textoError(error, status));
  if (esTablaFaltante(error, status)) return NextResponse.json({ error: AVISO_SIN_TABLA }, { status: 503 });
  if (error.code === "23505") {
    return NextResponse.json({ error: "Ya hay una query con ese nombre. Ponle otro." }, { status: 409 });
  }
  return NextResponse.json({ error: mensaje }, { status: 500 });
}

/** Quien llama, si puede escribir queries; si no, la respuesta de error. */
async function quienEscribe() {
  const sesion = await sesionConPermisos();
  if (!sesion) return { error: NextResponse.json({ error: "Sesión no válida o expirada." }, { status: 401 }) };
  if (!sesion.modulos.includes("fotos_query_sql")) {
    return {
      error: NextResponse.json(
        { error: "Tu perfil puede correr las queries guardadas, pero no cambiarlas: le falta «Escribir queries»." },
        { status: 403 }
      ),
    };
  }
  return { usuario: sesion.usuario };
}

/** Revisa nombre, SQL y columnas de un POST o PATCH. */
function leerCuerpo(body: Record<string, unknown>) {
  const nombre = limpiarNombreQuery(body.nombre);
  if (!nombre) {
    return { error: `Ponle un nombre a la query (hasta ${MAX_NOMBRE_QUERY} caracteres).` };
  }
  const revision = revisarSql(body.sql);
  if (!revision.ok) return { error: revision.error };
  // Se guarda como se escribió (con sus comentarios); se recorta al correrla.
  const sql = String(body.sql).replace(/\s+$/, "");
  return { fila: { nombre, sql, columnas: limpiarColumnas(body.columnas) } };
}

export async function GET() {
  const sesion = await sesionConPermisos();
  const puedeEditar = sesion?.modulos.includes("fotos_query_sql") ?? false;

  const { data, error, status } = await supabaseAdmin
    .from("queries_fotos")
    .select(COLUMNAS)
    .order("nombre", { ascending: true })
    .limit(500);

  if (error) {
    console.error("[queries-fotos GET]", textoError(error, status));
    if (esTablaFaltante(error, status)) {
      return NextResponse.json({ queries: [], aviso: AVISO_SIN_TABLA, puedeEditar });
    }
    return NextResponse.json({ error: "No se pudieron leer las queries guardadas." }, { status: 500 });
  }

  return NextResponse.json({
    queries: ((data ?? []) as FilaQuery[]).map(aQuery),
    aviso: null,
    puedeEditar,
  });
}

export async function POST(req: Request) {
  const quien = await quienEscribe();
  if ("error" in quien) return quien.error;

  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const leido = leerCuerpo(body);
  if ("error" in leido) return NextResponse.json({ error: leido.error }, { status: 400 });

  const { data, error, status } = await supabaseAdmin
    .from("queries_fotos")
    .insert({ ...leido.fila, creado_por: quien.usuario, actualizado_por: quien.usuario })
    .select(COLUMNAS)
    .single();
  if (error) return falla("crear", error, status, "No se pudo guardar la query.");

  const query = aQuery(data as FilaQuery);
  await registrarActividad(quien.usuario, "query_fotos_crear", { id: query.id, nombre: query.nombre });
  return NextResponse.json({ query });
}

export async function PATCH(req: Request) {
  const quien = await quienEscribe();
  if ("error" in quien) return quien.error;

  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Falta la query que se quiere cambiar." }, { status: 400 });
  }
  const leido = leerCuerpo(body);
  if ("error" in leido) return NextResponse.json({ error: leido.error }, { status: 400 });

  const antes = await supabaseAdmin.from("queries_fotos").select("nombre").eq("id", id).maybeSingle();
  if (antes.error) return falla("leer", antes.error, antes.status, "No se pudo guardar la query.");
  if (!antes.data) {
    return NextResponse.json({ error: "Esa query ya no existe: alguien la borró. Guárdala como nueva." }, { status: 404 });
  }

  const { data, error, status } = await supabaseAdmin
    .from("queries_fotos")
    .update({ ...leido.fila, actualizado_por: quien.usuario, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLUMNAS)
    .maybeSingle();
  if (error) return falla("editar", error, status, "No se pudo guardar la query.");
  if (!data) {
    return NextResponse.json({ error: "Esa query ya no existe: alguien la borró. Guárdala como nueva." }, { status: 404 });
  }

  const query = aQuery(data as FilaQuery);
  await registrarActividad(quien.usuario, "query_fotos_editar", {
    id,
    nombre: query.nombre,
    anterior: antes.data.nombre,
  });
  return NextResponse.json({ query });
}

export async function DELETE(req: Request) {
  const quien = await quienEscribe();
  if ("error" in quien) return quien.error;

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Falta la query que se quiere borrar." }, { status: 400 });
  }

  const { data, error, status } = await supabaseAdmin
    .from("queries_fotos")
    .delete()
    .eq("id", id)
    .select("nombre")
    .maybeSingle();
  if (error) return falla("borrar", error, status, "No se pudo borrar la query.");
  if (!data) return NextResponse.json({ error: "Esa query ya no existe." }, { status: 404 });

  await registrarActividad(quien.usuario, "query_fotos_eliminar", { id, nombre: data.nombre });
  return NextResponse.json({ ok: true });
}
