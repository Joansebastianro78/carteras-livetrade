import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { leerMantenimiento } from "@/lib/mantenimiento";
import { CAMPOS_TERRITORIO, type PuntoTerritorio } from "@/lib/territorio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cómo está la cartera hoy.
 *
 *   GET ?corto=1                    → ciclo actual, ciclos y mantenimiento (barra del panel)
 *   GET                             → lo anterior y además: las cifras de toda la
 *                                     cartera, todos los ciclos (general: puntos,
 *                                     asignados, LIBRE, consultores con puntos y sin
 *                                     coordenadas), las dos últimas cargas y los
 *                                     puntos por departamento, también de toda la
 *                                     cartera
 *   GET ?lista=sin-ubicacion|libres → los puntos de toda la cartera sin coordenadas
 *                                     o sin consultor, para descargarlos
 *
 * El ciclo actual es el que se tocó más recientemente.
 * Solo GET: el BackOffice también lo puede leer.
 */

type FilaCiclo = {
  ciclo: string;
  puntos: number;
  consultores: number;
  sin_ubicacion: number;
  ultima_actualizacion: string | null;
};

const TOPE_LISTA = 10_000;

async function leerCiclos(): Promise<FilaCiclo[] | null> {
  const { data, error } = await supabaseAdmin
    .from("resumen_ciclos")
    .select("ciclo,puntos,consultores,sin_ubicacion,ultima_actualizacion")
    .order("ultima_actualizacion", { ascending: false });
  if (error) {
    console.error("[resumen ciclos]", error.message);
    return null;
  }
  return (data ?? []) as FilaCiclo[];
}

function filtroLibres<T extends { or: (f: string) => T }>(consulta: T): T {
  return consulta.or("usuario.eq.LIBRE,ccuser.eq.LIBRE");
}

async function contarLibres(ciclo: string): Promise<number | null> {
  const { count, error } = await filtroLibres(
    supabaseAdmin
      .from("puntos_cartera")
      .select("id_registro", { count: "exact", head: true })
      .eq("ciclo", ciclo)
  );
  if (error) {
    console.error("[resumen libres]", error.message);
    return null;
  }
  return count ?? 0;
}

/** Si en el ciclo hay puntos con usuario LIBRE (la vista lo cuenta como consultor). */
/** Puntos sin consultor (LIBRE) en toda la cartera, todos los ciclos. */
async function contarLibresTodos(): Promise<number | null> {
  const { count, error } = await filtroLibres(
    supabaseAdmin.from("puntos_cartera").select("id_registro", { count: "exact", head: true })
  );
  if (error) {
    console.error("[resumen libres todos]", error.message);
    return null;
  }
  return count ?? 0;
}

/**
 * Consultores con al menos un punto, en toda la cartera. Un consultor es la
 * pareja usuario + cédula, igual que en el buscador del BackOffice
 * (resumen_consultores ya deja fuera los LIBRE).
 */
async function contarConsultoresTodos(): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from("resumen_consultores")
    .select("usuario", { count: "exact", head: true });
  if (error) {
    console.error("[resumen consultores]", error.message);
    return null;
  }
  return count ?? 0;
}

async function contarUsuarioLibre(ciclo: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("puntos_cartera")
    .select("id_registro", { count: "exact", head: true })
    .eq("ciclo", ciclo)
    .eq("usuario", "LIBRE");
  return count ?? 0;
}

async function leerCargas() {
  const { data, error } = await supabaseAdmin
    .from("cargas_cartera")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(2);
  if (error) {
    console.error("[resumen cargas]", error.message);
    return [];
  }
  return (data ?? []).map((c) => ({
    archivo: c.archivo as string,
    modo: (c.modo as string | null) ?? null,
    filas: c.filas as number,
    filas_ok: c.filas_ok as number,
    filas_error: (c.filas_error as number) ?? 0,
    detalle: Array.isArray(c.detalle) ? (c.detalle as { fila: number; motivo: string }[]) : [],
    cargado_por: (c.cargado_por as string | null) ?? null,
    created_at: c.created_at as string,
  }));
}

/** Puntos por departamento de toda la cartera, del más grande al más chico. */
async function leerDepartamentos() {
  const suma = new Map<string, { nombre: string; puntos: number }>();

  for (let desde = 0; desde < 20_000; desde += 1000) {
    const { data, error } = await supabaseAdmin
      .from("resumen_territorio")
      .select("departamento_clave,departamento,puntos")
      .order("departamento_clave", { ascending: true })
      .order("ciudad_clave", { ascending: true })
      .order("ciclo", { ascending: true })
      .range(desde, desde + 999);

    // Sin territorio.sql no hay vista: el Inicio simplemente no muestra el bloque.
    if (error) {
      console.error("[resumen departamentos]", error.message);
      return null;
    }

    for (const f of data ?? []) {
      const clave = (f.departamento_clave as string | null) ?? "~";
      const actual = suma.get(clave) ?? {
        nombre: (f.departamento as string | null)?.trim() || "Sin departamento",
        puntos: 0,
      };
      actual.puntos += Number(f.puntos) || 0;
      suma.set(clave, actual);
    }
    if (!data || data.length < 1000) break;
  }

  return [...suma.values()].sort((a, b) => b.puntos - a.puntos);
}

async function lista(tipo: string) {
  const puntos: PuntoTerritorio[] = [];

  for (let desde = 0; desde < TOPE_LISTA; desde += 1000) {
    let consulta = supabaseAdmin.from("puntos_cartera").select(CAMPOS_TERRITORIO);

    consulta = tipo === "libres" ? filtroLibres(consulta) : consulta.is("latitud", null);

    const { data, error } = await consulta
      .order("ciclo", { ascending: true })
      .order("id_pdv", { ascending: true })
      .range(desde, desde + 999);

    if (error) {
      console.error("[resumen lista]", error.message);
      return NextResponse.json({ error: "No se pudieron leer los puntos." }, { status: 500 });
    }

    puntos.push(...((data ?? []) as unknown as PuntoTerritorio[]));
    if (!data || data.length < 1000) break;
  }

  return NextResponse.json({ puntos });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const [ciclos, mantenimiento] = await Promise.all([leerCiclos(), leerMantenimiento()]);
  const actual = ciclos?.[0] ?? null;
  const ciclo = actual?.ciclo ?? null;

  const tipoLista = searchParams.get("lista");
  if (tipoLista) {
    if (tipoLista !== "sin-ubicacion" && tipoLista !== "libres") {
      return NextResponse.json({ error: "Lista desconocida." }, { status: 400 });
    }
    return lista(tipoLista);
  }

  const base = {
    ciclo,
    ciclos: ciclos ?? [],
    mantenimiento: { activo: mantenimiento.activo, hasta: mantenimiento.hasta },
  };

  if (searchParams.get("corto")) return NextResponse.json(base);

  const [libres, conUsuarioLibre, cargas, departamentos, libresTodos, consultoresTodos] =
    await Promise.all([
      ciclo === null ? Promise.resolve(0) : contarLibres(ciclo),
      ciclo === null ? Promise.resolve(0) : contarUsuarioLibre(ciclo),
      leerCargas(),
      leerDepartamentos(),
      contarLibresTodos(),
      contarConsultoresTodos(),
    ]);

  // Toda la cartera, sin importar el ciclo: lo que muestran las cifras del Inicio.
  const puntosTodos = (ciclos ?? []).reduce((a, c) => a + (Number(c.puntos) || 0), 0);
  const general = {
    puntos: puntosTodos,
    sin_ubicacion: (ciclos ?? []).reduce((a, c) => a + (Number(c.sin_ubicacion) || 0), 0),
    asignados: libresTodos === null ? null : Math.max(0, puntosTodos - libresTodos),
    libres: libresTodos,
    consultores: consultoresTodos,
  };

  // resumen_ciclos cuenta LIBRE como si fuera un consultor más.
  const ajustado =
    actual && conUsuarioLibre ? { ...actual, consultores: Math.max(0, actual.consultores - 1) } : actual;

  return NextResponse.json({
    ...base,
    errorCiclos: ciclos === null ? "No se pudo leer el resumen de ciclos." : null,
    actual: ajustado,
    general,
    libres,
    ultimaCarga: cargas[0] ?? null,
    cargaAnterior: cargas[1] ?? null,
    departamentos,
  });
}
