import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  CAMPOS_TERRITORIO,
  SIN_DATO,
  nombreCiudad,
  nombreDepartamento,
  type CiudadResumen,
  type DepartamentoResumen,
  type PuntoTerritorio,
  type RespuestaPuntosTerritorio,
  type RespuestaResumenTerritorio,
} from "@/lib/territorio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * BackOffice: puntos por departamento y ciudad.
 *
 *   GET ?resumen=1[&ciclo=X]                        → departamentos y ciudades con su conteo
 *   GET ?departamento=K[&ciudad=K][&ciclo=X]&desde=N → una página de puntos
 *
 * Las claves (K) son las de clave_territorio() en supabase/territorio.sql.
 * "~" significa sin departamento, sin ciudad o ciclo vacío.
 *
 * Los puntos van por páginas de 1000: Supabase no devuelve más de eso por
 * consulta, y una sola respuesta con toda una región pasaría del límite de
 * tamaño de las funciones de Vercel. El navegador pide página tras página.
 */

const TAM_PAGINA = 1000;
const TOPE_FILAS_RESUMEN = 50_000;

const AVISO_SIN_SQL =
  "Falta preparar la base para este filtro. Ejecuta supabase/territorio.sql en el SQL Editor.";

function faltaSql(mensaje: string): boolean {
  return /departamento_clave|ciudad_clave|resumen_territorio|does not exist|schema cache/i.test(
    mensaje
  );
}

function errorDeBase(etiqueta: string, mensaje: string, generico: string) {
  console.error(`[territorio ${etiqueta}]`, mensaje);
  return NextResponse.json(
    { error: faltaSql(mensaje) ? AVISO_SIN_SQL : generico },
    { status: 500 }
  );
}

/** "~" → "", cualquier otro valor tal cual. */
function cicloReal(ciclo: string): string {
  return ciclo === SIN_DATO ? "" : ciclo;
}

const enEspanol = (a: string, b: string) => a.localeCompare(b, "es");

// ------------------------------------------------------------------ resumen
type FilaResumen = {
  departamento_clave: string | null;
  ciudad_clave: string | null;
  departamento: string | null;
  ciudad: string | null;
  puntos: number;
};

async function resumen(ciclo: string | null) {
  // La vista trae una fila por departamento, ciudad y ciclo. Puede pasar de
  // 1000 filas, así que también se lee por páginas.
  const filas: FilaResumen[] = [];

  for (let desde = 0; desde < TOPE_FILAS_RESUMEN; ) {
    let consulta = supabaseAdmin
      .from("resumen_territorio")
      .select("departamento_clave,ciudad_clave,departamento,ciudad,puntos");

    if (ciclo !== null) consulta = consulta.eq("ciclo", cicloReal(ciclo));

    const { data, error } = await consulta
      .order("departamento_clave", { ascending: true, nullsFirst: false })
      .order("ciudad_clave", { ascending: true, nullsFirst: false })
      .order("ciclo", { ascending: true })
      .range(desde, desde + TAM_PAGINA - 1);

    if (error) {
      return errorDeBase("resumen", error.message, "No se pudo leer el resumen por región.");
    }

    const pagina = (data ?? []) as FilaResumen[];
    if (pagina.length === 0) break;
    filas.push(...pagina);
    // Se avanza por lo que llegó y no por lo pedido: si el proyecto tiene
    // configurado un tope menor a 1000, igual se leen todas las filas.
    desde += pagina.length;
  }

  const departamentos = new Map<
    string,
    { nombre: string; puntos: number; ciudades: Map<string, CiudadResumen> }
  >();

  for (const f of filas) {
    const dClave = f.departamento_clave ?? SIN_DATO;
    const cClave = f.ciudad_clave ?? SIN_DATO;
    const n = Number(f.puntos) || 0;

    const nombreD = nombreDepartamento(f.departamento);
    const nombreC = nombreCiudad(f.ciudad);

    let d = departamentos.get(dClave);
    if (!d) {
      d = { nombre: nombreD, puntos: 0, ciudades: new Map() };
      departamentos.set(dClave, d);
    }
    d.puntos += n;
    // Entre variantes del mismo nombre en distintos ciclos, la que lleva tilde.
    if (enEspanol(nombreD, d.nombre) > 0) d.nombre = nombreD;

    const c = d.ciudades.get(cClave);
    if (!c) d.ciudades.set(cClave, { clave: cClave, nombre: nombreC, puntos: n });
    else {
      c.puntos += n;
      if (enEspanol(nombreC, c.nombre) > 0) c.nombre = nombreC;
    }
  }

  // Orden alfabético, con "sin departamento" y "sin ciudad" al final.
  const alFinal = (a: { clave: string; nombre: string }, b: { clave: string; nombre: string }) =>
    a.clave === SIN_DATO ? 1 : b.clave === SIN_DATO ? -1 : enEspanol(a.nombre, b.nombre);

  const lista: DepartamentoResumen[] = [...departamentos.entries()]
    .map(([clave, d]) => ({
      clave,
      nombre: d.nombre,
      puntos: d.puntos,
      ciudades: [...d.ciudades.values()].sort(alFinal),
    }))
    .sort(alFinal);

  // Los ciclos salen de la vista que ya usa el panel de administración.
  const { data: ciclos, error: errorCiclos } = await supabaseAdmin
    .from("resumen_ciclos")
    .select("ciclo");

  if (errorCiclos) console.error("[territorio ciclos]", errorCiclos.message);

  const respuesta: RespuestaResumenTerritorio = {
    departamentos: lista,
    ciclos: [...new Set((ciclos ?? []).map((c) => String(c.ciclo ?? "")))].sort(enEspanol),
  };

  return NextResponse.json(respuesta);
}

// ------------------------------------------------------------------ puntos
async function puntos(
  departamento: string | null,
  ciudad: string | null,
  ciclo: string | null,
  desde: number
) {
  let consulta = supabaseAdmin
    .from("puntos_cartera")
    .select(CAMPOS_TERRITORIO, { count: "exact" });

  if (departamento) {
    consulta =
      departamento === SIN_DATO
        ? consulta.is("departamento_clave", null)
        : consulta.eq("departamento_clave", departamento);
  }

  if (ciudad) {
    consulta =
      ciudad === SIN_DATO
        ? consulta.is("ciudad_clave", null)
        : consulta.eq("ciudad_clave", ciudad);
  }

  if (ciclo !== null) consulta = consulta.eq("ciclo", cicloReal(ciclo));

  // id_registro va de último para que el orden sea estable entre páginas.
  const { data, error, count } = await consulta
    .order("ciudad_clave", { ascending: true, nullsFirst: false })
    .order("usuario", { ascending: true })
    .order("ciclo", { ascending: true })
    .order("ruta", { ascending: true, nullsFirst: false })
    .order("pdv", { ascending: true })
    .order("id_registro", { ascending: true })
    .range(desde, desde + TAM_PAGINA - 1);

  if (error) {
    return errorDeBase("puntos", error.message, "No se pudieron leer los puntos de esa región.");
  }

  const lista = (data ?? []) as unknown as PuntoTerritorio[];
  const total = count ?? desde + lista.length;
  const llegaron = desde + lista.length;

  const respuesta: RespuestaPuntosTerritorio = {
    puntos: lista,
    total,
    siguiente: lista.length > 0 && llegaron < total ? llegaron : null,
  };

  return NextResponse.json(respuesta);
}

// ------------------------------------------------------------------ entrada
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ciclo = searchParams.get("ciclo");

  if (searchParams.get("resumen")) return resumen(ciclo);

  const departamento = (searchParams.get("departamento") ?? "").trim() || null;
  const ciudad = (searchParams.get("ciudad") ?? "").trim() || null;

  if (!departamento && !ciudad) {
    return NextResponse.json(
      { error: "Elige un departamento o una ciudad." },
      { status: 400 }
    );
  }

  const desde = Number(searchParams.get("desde") ?? 0);
  if (!Number.isInteger(desde) || desde < 0) {
    return NextResponse.json({ error: "Página no válida." }, { status: 400 });
  }

  return puntos(departamento, ciudad, ciclo, desde);
}
