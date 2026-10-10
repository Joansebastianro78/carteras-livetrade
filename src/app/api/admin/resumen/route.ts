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
 *   GET                             → lo anterior y además: puntos sin consultor, las
 *                                     dos últimas cargas y los puntos por departamento
 *   GET ?lista=sin-ubicacion|libres → los puntos del ciclo actual sin coordenadas o
 *                                     sin consultor, para descargarlos
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

/** Puntos por departamento del ciclo, del más grande al más chico. */
async function leerDepartamentos(ciclo: string) {
  const suma = new Map<string, { nombre: string; puntos: number }>();

  for (let desde = 0; desde < 20_000; desde += 1000) {
    const { data, error } = await supabaseAdmin
      .from("resumen_territorio")
      .select("departamento_clave,departamento,puntos")
      .eq("ciclo", ciclo)
      .order("departamento_clave", { ascending: true })
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

async function lista(tipo: string, ciclo: string) {
  const puntos: PuntoTerritorio[] = [];

  for (let desde = 0; desde < TOPE_LISTA; desde += 1000) {
    let consulta = supabaseAdmin
      .from("puntos_cartera")
      .select(CAMPOS_TERRITORIO)
      .eq("ciclo", ciclo);

    consulta = tipo === "libres" ? filtroLibres(consulta) : consulta.is("latitud", null);

    const { data, error } = await consulta
      .order("id_pdv", { ascending: true })
      .range(desde, desde + 999);

    if (error) {
      console.error("[resumen lista]", error.message);
      return NextResponse.json({ error: "No se pudieron leer los puntos." }, { status: 500 });
    }

    puntos.push(...((data ?? []) as unknown as PuntoTerritorio[]));
    if (!data || data.length < 1000) break;
  }

  return NextResponse.json({ ciclo, puntos });
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
    if (ciclo === null) return NextResponse.json({ ciclo: null, puntos: [] });
    return lista(tipoLista, ciclo);
  }

  const base = {
    ciclo,
    ciclos: ciclos ?? [],
    mantenimiento: { activo: mantenimiento.activo, hasta: mantenimiento.hasta },
  };

  if (searchParams.get("corto")) return NextResponse.json(base);

  const [libres, conUsuarioLibre, cargas, departamentos] = await Promise.all([
    ciclo === null ? Promise.resolve(0) : contarLibres(ciclo),
    ciclo === null ? Promise.resolve(0) : contarUsuarioLibre(ciclo),
    leerCargas(),
    ciclo === null ? Promise.resolve([]) : leerDepartamentos(ciclo),
  ]);

  // resumen_ciclos cuenta LIBRE como si fuera un consultor más.
  const ajustado =
    actual && conUsuarioLibre ? { ...actual, consultores: Math.max(0, actual.consultores - 1) } : actual;

  return NextResponse.json({
    ...base,
    errorCiclos: ciclos === null ? "No se pudo leer el resumen de ciclos." : null,
    actual: ajustado,
    libres,
    ultimaCarga: cargas[0] ?? null,
    cargaAnterior: cargas[1] ?? null,
    departamentos,
  });
}
