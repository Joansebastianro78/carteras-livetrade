import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_ADMIN, leerSesion } from "@/lib/auth";
import {
  aEntero,
  aTexto,
  dentroDeColombia,
  LIMITE_LAT,
  LIMITE_LNG,
  normalizarCedula,
  normalizarCoordenada,
  normalizarUsuario,
} from "@/lib/normalizar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Solo estos campos se pueden editar a mano. El resto (id_registro, ciclo,
 * created_at, los estados de visita que escribe LiveTrade) se deja fuera a
 * propósito: editarlos desde aquí descuadraría el origen.
 */
const CAMPOS_EDITABLES = [
  "pdv",
  "direccion",
  "persona_hacku",
  "celular",
  "que_hacer",
  "ruta",
  "num_de_ruta",
  "usuario",
  "ccuser",
  "nom",
  "persona",
  "latitud",
  "longitud",
] as const;

type CampoEditable = (typeof CAMPOS_EDITABLES)[number];

async function quien(): Promise<string | null> {
  const store = await cookies();
  const s = await leerSesion(store.get(COOKIE_ADMIN)?.value, process.env.ADMIN_SECRET);
  return s?.usuario ?? null;
}

// ---------------------------------------------------------------- búsqueda
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const ciclo = searchParams.get("ciclo");

  if (q.length < 2 && !ciclo) {
    return NextResponse.json(
      { error: "Escribe al menos dos caracteres para buscar." },
      { status: 400 }
    );
  }

  let consulta = supabaseAdmin
    .from("puntos_cartera")
    .select(
      "id_registro,id_pdv,bavaria,pdv,direccion,persona_hacku,celular,que_hacer," +
        "ciclo,ruta,num_de_ruta,usuario,ccuser,nom,persona,latitud,longitud"
    )
    .limit(60);

  if (ciclo) consulta = consulta.eq("ciclo", ciclo);

  if (q.length >= 2) {
    // PostgREST separa los filtros de .or() por comas y usa * como comodín,
    // así que hay que sacarlos del texto del usuario antes de armar la cadena.
    const limpio = q.replace(/[,()*%]/g, " ").trim();
    consulta = consulta.or(
      [
        `id_pdv.eq.${limpio}`,
        `bavaria.eq.${limpio}`,
        `pdv.ilike.*${limpio}*`,
        `direccion.ilike.*${limpio}*`,
        `usuario.eq.${limpio.toUpperCase()}`,
        `ccuser.eq.${limpio.replace(/\D/g, "") || "0"}`,
        `persona_hacku.ilike.*${limpio}*`,
      ].join(",")
    );
  }

  const { data, error } = await consulta.order("pdv", { ascending: true });

  if (error) {
    console.error("[puntos GET]", error.message);
    return NextResponse.json({ error: "Falló la búsqueda." }, { status: 500 });
  }

  return NextResponse.json({ puntos: data ?? [] });
}

// ---------------------------------------------------------------- edición
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    id_registro?: number;
    cambios?: Record<string, unknown>;
  };

  if (!body.id_registro || !body.cambios) {
    return NextResponse.json({ error: "Faltan datos del punto." }, { status: 400 });
  }

  const cambios: Record<string, unknown> = {};

  for (const campo of CAMPOS_EDITABLES) {
    if (!(campo in body.cambios)) continue;
    const bruto = (body.cambios as Record<CampoEditable, unknown>)[campo];

    switch (campo) {
      case "ruta":
      case "num_de_ruta":
        cambios[campo] = aEntero(bruto);
        break;
      case "usuario":
        cambios[campo] = normalizarUsuario(bruto);
        break;
      case "ccuser":
        cambios[campo] = normalizarCedula(bruto);
        break;
      case "latitud":
        cambios[campo] = normalizarCoordenada(bruto, LIMITE_LAT)[0];
        break;
      case "longitud":
        cambios[campo] = normalizarCoordenada(bruto, LIMITE_LNG)[0];
        break;
      default:
        cambios[campo] = aTexto(bruto);
    }
  }

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No hay cambios que guardar." }, { status: 400 });
  }

  // usuario y ccuser son la llave con la que el vendedor entra: si uno queda
  // vacío, el punto se vuelve inalcanzable sin que nadie se entere.
  if ("usuario" in cambios && !cambios.usuario) {
    return NextResponse.json({ error: "El usuario no puede quedar vacío." }, { status: 400 });
  }
  if ("ccuser" in cambios && !cambios.ccuser) {
    return NextResponse.json({ error: "La cédula no puede quedar vacía." }, { status: 400 });
  }

  const lat = cambios.latitud as number | null | undefined;
  const lng = cambios.longitud as number | null | undefined;
  if (
    typeof lat === "number" &&
    typeof lng === "number" &&
    !dentroDeColombia(lat, lng)
  ) {
    return NextResponse.json(
      { error: "Esa coordenada cae fuera de Colombia. Revisa latitud y longitud." },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("puntos_cartera")
    .update(cambios)
    .eq("id_registro", body.id_registro)
    .select("id_registro,id_pdv,ciclo")
    .maybeSingle();

  if (error) {
    console.error("[puntos PATCH]", error.message);
    return NextResponse.json({ error: `No se pudo guardar: ${error.message}` }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Ese punto ya no existe." }, { status: 404 });
  }

  await supabaseAdmin.from("auditoria_cartera").insert({
    accion: "editar",
    id_pdv: data.id_pdv,
    ciclo: data.ciclo,
    detalle: cambios,
    hecho_por: await quien(),
  });

  return NextResponse.json({ ok: true, cambios });
}

// ---------------------------------------------------------------- borrado
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id_registro"));

  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Falta el punto a eliminar." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("puntos_cartera")
    .delete()
    .eq("id_registro", id)
    .select("id_pdv,ciclo,pdv")
    .maybeSingle();

  if (error) {
    console.error("[puntos DELETE]", error.message);
    return NextResponse.json({ error: "No se pudo eliminar el punto." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Ese punto ya no existe." }, { status: 404 });
  }

  await supabaseAdmin.from("auditoria_cartera").insert({
    accion: "eliminar",
    id_pdv: data.id_pdv,
    ciclo: data.ciclo,
    detalle: { pdv: data.pdv },
    hecho_por: await quien(),
  });

  return NextResponse.json({ ok: true });
}
