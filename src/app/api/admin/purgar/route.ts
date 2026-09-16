import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_ADMIN, leerSesion } from "@/lib/auth";
import { FRASE_PURGA } from "@/lib/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ------------------------------------------------- resumen por ciclo y archivo
export async function GET() {
  const [porCiclo, porArchivo] = await Promise.all([
    supabaseAdmin.from("resumen_ciclos").select("*"),
    supabaseAdmin.from("resumen_archivos").select("*"),
  ]);

  if (porCiclo.error) {
    console.error("[purgar GET ciclos]", porCiclo.error.message);
    return NextResponse.json(
      { error: "No se pudo leer el resumen de ciclos." },
      { status: 500 }
    );
  }

  // La vista de archivos es más nueva que la de ciclos. Si todavía no se ha
  // corrido gestion.sql el panel sigue sirviendo, solo sin esa opción.
  let avisoArchivos: string | null = null;
  if (porArchivo.error) {
    console.error("[purgar GET archivos]", porArchivo.error.message);
    avisoArchivos =
      "No se pudo listar los archivos cargados. Ejecuta supabase/gestion.sql en el SQL Editor para crear la vista resumen_archivos.";
  }

  return NextResponse.json({
    ciclos: porCiclo.data ?? [],
    archivos: porArchivo.data ?? [],
    avisoArchivos,
  });
}

// ------------------------------------------------- borrado masivo
type Alcance = "todo" | "ciclo" | "archivo";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    alcance?: Alcance;
    valor?: string | null;
    /** Forma antigua del cuerpo, cuando solo se podía borrar por ciclo. */
    ciclo?: string | null;
    confirmacion?: string;
  };

  const store = await cookies();
  const sesion = await leerSesion(
    store.get(COOKIE_ADMIN)?.value,
    process.env.ADMIN_SECRET
  );

  const alcance: Alcance = body.alcance ?? (body.ciclo ? "ciclo" : "todo");
  const valor = (body.valor ?? body.ciclo ?? "").trim();

  if (alcance === "archivo" && !valor) {
    return NextResponse.json(
      { error: "Elige cuál archivo quieres eliminar." },
      { status: 400 }
    );
  }

  // Borrar toda la cartera es irreversible, así que exige escribir la frase.
  // Borrar un ciclo o un archivo concreto exige escribir su nombre exacto.
  // Un ciclo vacío no tiene nombre que escribir, así que cae en la frase.
  const esperado = alcance === "todo" || valor === "" ? FRASE_PURGA : valor;
  if ((body.confirmacion ?? "").trim() !== esperado) {
    return NextResponse.json(
      { error: `Para continuar escribe exactamente: ${esperado}` },
      { status: 400 }
    );
  }

  const consulta = supabaseAdmin.from("puntos_cartera").delete({ count: "exact" });

  const { count, error } =
    alcance === "ciclo"
      ? await consulta.eq("ciclo", valor)
      : alcance === "archivo"
        ? await consulta.eq("archivo_origen", valor)
        : await consulta.gt("id_registro", 0); // Supabase exige un filtro en DELETE

  if (error) {
    console.error("[purgar POST]", error.message);
    return NextResponse.json(
      { error: `No se pudo eliminar: ${error.message}` },
      { status: 500 }
    );
  }

  const descripcion =
    alcance === "ciclo"
      ? `ciclo ${valor || "sin ciclo"}`
      : alcance === "archivo"
        ? `archivo ${valor}`
        : "toda la cartera";

  await supabaseAdmin.from("auditoria_cartera").insert({
    accion: "purgar",
    ciclo: alcance === "ciclo" ? valor : null,
    detalle: { eliminados: count ?? 0, alcance: descripcion },
    hecho_por: sesion?.usuario ?? null,
  });

  return NextResponse.json({ ok: true, eliminados: count ?? 0, alcance: descripcion });
}
