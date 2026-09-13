import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_ADMIN, leerSesion } from "@/lib/auth";
import type { FilaCartera, ModoCarga } from "@/lib/excel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILAS_POR_LOTE = 1000;

/**
 * Campos que un Excel puede escribir. id_registro, created_at y updated_at
 * quedan fuera: los maneja la base.
 */
const CAMPOS_IMPORTABLES = new Set([
  "id_pdv", "ciclo", "bavaria", "pdv", "direccion", "persona_hacku", "celular",
  "que_hacer", "fecha_nacimiento", "departamento", "ciudad", "estado_v1",
  "fecha_v1", "hora_v1", "usuario_v1", "hacku_estado", "hacku_curso",
  "estado_v2", "fecha_v2", "hora_v2", "usuario_v2", "estado_v3", "fecha_v3",
  "hora_v3", "usuario_v3", "motivo", "motivo_dueno", "comentario",
  "duracion_v1", "ruta", "latitud", "longitud", "num_de_ruta", "persona",
  "ccuser", "usuario", "nom", "coord_corregida", "archivo_origen",
]);

type Cuerpo = {
  filas: FilaCartera[];
  archivo?: string;
  modo?: ModoCarga;
  /** true si el Excel traía columna CICLO: el emparejamiento es exacto. */
  tieneCiclo?: boolean;
  final?: boolean;
  resumen?: { filas: number; filasOk: number; filasError: number; detalle?: unknown };
};

/** Valores por defecto de las columnas not null, para rellenar huecos del lote. */
const RELLENO: Record<string, unknown> = {
  ciclo: "",
  coord_corregida: false,
};

/**
 * Iguala las claves de todas las filas del lote.
 *
 * PostgREST arma un solo INSERT con la unión de las claves del lote y pone null
 * en las filas que no traen una clave. Si una sola fila lleva un campo extra,
 * el resto intenta escribir null ahí; en una columna not null eso tumba el
 * lote entero. Por eso rellenamos con el valor por defecto de la columna en
 * vez de dejar que PostgREST decida.
 */
function uniformar(filas: Record<string, unknown>[]): Record<string, unknown>[] {
  const claves = new Set<string>();
  for (const f of filas) for (const k of Object.keys(f)) claves.add(k);

  return filas.map((f) => {
    const salida: Record<string, unknown> = {};
    for (const k of claves) {
      salida[k] = k in f ? f[k] : (RELLENO[k] ?? null);
    }
    return salida;
  });
}

/** Campos sin los cuales una fila nueva no se puede insertar. */
const OBLIGATORIOS_AL_INSERTAR = ["usuario", "ccuser"];

function faltanObligatorios(filas: Record<string, unknown>[]): string[] {
  const presentes = new Set<string>();
  for (const f of filas) for (const k of Object.keys(f)) presentes.add(k);
  return OBLIGATORIOS_AL_INSERTAR.filter((c) => !presentes.has(c));
}

function limpiarFila(f: FilaCartera, archivo?: string): Record<string, unknown> | null {
  if (!f || typeof f.id_pdv !== "string" || f.id_pdv.length === 0) return null;

  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (CAMPOS_IMPORTABLES.has(k)) salida[k] = v;
  }
  if (archivo) salida.archivo_origen = archivo;
  return salida;
}

export async function POST(req: Request) {
  let body: Cuerpo;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Petición mal formada." }, { status: 400 });
  }

  const { filas, archivo, tieneCiclo } = body;
  const modo: ModoCarga = body.modo ?? "reemplazar";

  if (!Array.isArray(filas) || filas.length === 0) {
    return NextResponse.json({ error: "El lote llegó vacío." }, { status: 400 });
  }
  if (filas.length > MAX_FILAS_POR_LOTE) {
    return NextResponse.json(
      { error: `Máximo ${MAX_FILAS_POR_LOTE} filas por lote.` },
      { status: 413 }
    );
  }

  const limpias = filas
    .map((f) => limpiarFila(f, archivo))
    .filter((f): f is Record<string, unknown> => f !== null);

  if (limpias.length === 0) {
    return NextResponse.json(
      { error: "Ninguna fila del lote tiene ID de PDV." },
      { status: 400 }
    );
  }

  let guardadas = 0;
  let omitidas = 0;
  const noEncontradas: string[] = [];

  // -------------------------------------------------------------- reemplazar
  if (modo === "reemplazar") {
    // Necesita CICLO: es la segunda mitad de la llave del UPSERT.
    if (!tieneCiclo) {
      return NextResponse.json(
        {
          error:
            "Para reemplazar, el archivo debe traer la columna CICLO. Si solo quieres corregir datos, usa el modo actualizar.",
        },
        { status: 400 }
      );
    }

    const faltan = faltanObligatorios(limpias);
    if (faltan.length > 0) {
      return NextResponse.json(
        {
          error: `Para reemplazar, el archivo debe traer las columnas ${faltan
            .map((c) => (c === "usuario" ? "user" : c))
            .join(" y ")}. Sin ellas los puntos nuevos quedarían sin vendedor asignado.`,
        },
        { status: 400 }
      );
    }

    const conCiclo = uniformar(limpias.map((f) => ({ ...f, ciclo: f.ciclo ?? "" })));

    const { error, count } = await supabaseAdmin
      .from("puntos_cartera")
      .upsert(conCiclo, { onConflict: "id_pdv,ciclo", count: "exact" });

    if (error) {
      console.error("[upload reemplazar]", error.message);
      return NextResponse.json(
        { error: `Supabase rechazó el lote: ${error.message}` },
        { status: 500 }
      );
    }
    guardadas = count ?? conCiclo.length;
  }

  // ------------------------------------------------- actualizar / agregar
  else {
    // Ambos modos necesitan saber qué puntos ya existen. Una sola consulta
    // por lote en vez de una por fila.
    const ids = [...new Set(limpias.map((f) => f.id_pdv as string))];

    const { data: existentes, error: errorBusqueda } = await supabaseAdmin
      .from("puntos_cartera")
      .select("id_registro,id_pdv,ciclo")
      .in("id_pdv", ids);

    if (errorBusqueda) {
      console.error("[upload buscar]", errorBusqueda.message);
      return NextResponse.json(
        { error: `No se pudo consultar la cartera: ${errorBusqueda.message}` },
        { status: 500 }
      );
    }

    const porClave = new Map<string, number[]>();
    for (const e of existentes ?? []) {
      // Con CICLO en el archivo la llave es exacta; sin CICLO, el mismo ID
      // puede corresponder a varios ciclos y se actualizan todos.
      const claves = tieneCiclo ? [`${e.id_pdv}|${e.ciclo}`] : [e.id_pdv];
      for (const k of claves) {
        porClave.set(k, [...(porClave.get(k) ?? []), e.id_registro]);
      }
    }

    if (modo === "agregar") {
      const nuevas = limpias.filter((f) => {
        const k = tieneCiclo ? `${f.id_pdv}|${f.ciclo ?? ""}` : (f.id_pdv as string);
        if (porClave.has(k)) {
          omitidas++;
          return false;
        }
        return true;
      });

      if (nuevas.length > 0) {
        const faltan = faltanObligatorios(nuevas);
        if (faltan.length > 0) {
          return NextResponse.json(
            {
              error: `Para agregar puntos nuevos, el archivo debe traer las columnas ${faltan
                .map((c) => (c === "usuario" ? "user" : c))
                .join(" y ")}.`,
            },
            { status: 400 }
          );
        }

        const { error, count } = await supabaseAdmin
          .from("puntos_cartera")
          .insert(uniformar(nuevas.map((f) => ({ ...f, ciclo: f.ciclo ?? "" }))), {
            count: "exact",
          });

        if (error) {
          console.error("[upload agregar]", error.message);
          return NextResponse.json(
            { error: `Supabase rechazó el lote: ${error.message}` },
            { status: 500 }
          );
        }
        guardadas = count ?? nuevas.length;
      }
    } else {
      // actualizar: solo toca las columnas que venían en el archivo, y solo
      // sobre puntos que ya existen. No crea nada.
      for (const f of limpias) {
        const k = tieneCiclo ? `${f.id_pdv}|${f.ciclo ?? ""}` : (f.id_pdv as string);
        const objetivos = porClave.get(k);

        if (!objetivos || objetivos.length === 0) {
          if (noEncontradas.length < 50) noEncontradas.push(f.id_pdv as string);
          omitidas++;
          continue;
        }

        // id_pdv y ciclo son la llave: no se reescriben a sí mismos.
        const cambios = { ...f };
        delete cambios.id_pdv;
        delete cambios.ciclo;

        if (Object.keys(cambios).length === 0) continue;

        const { error, count } = await supabaseAdmin
          .from("puntos_cartera")
          .update(cambios, { count: "exact" })
          .in("id_registro", objetivos);

        if (error) {
          console.error("[upload actualizar]", error.message);
          return NextResponse.json(
            { error: `Falló al actualizar el PDV ${f.id_pdv}: ${error.message}` },
            { status: 500 }
          );
        }
        guardadas += count ?? objetivos.length;
      }
    }
  }

  if (body.final && body.resumen) {
    const store = await cookies();
    const sesion = await leerSesion(
      store.get(COOKIE_ADMIN)?.value,
      process.env.ADMIN_SECRET
    );

    await supabaseAdmin.from("cargas_cartera").insert({
      archivo: archivo ?? "sin-nombre.xlsx",
      modo,
      filas: body.resumen.filas,
      filas_ok: body.resumen.filasOk,
      filas_error: body.resumen.filasError,
      detalle: body.resumen.detalle ?? null,
      cargado_por: sesion?.usuario ?? null,
    });
  }

  return NextResponse.json({ ok: true, guardadas, omitidas, noEncontradas });
}
