import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_ADMIN, leerSesion } from "@/lib/auth";
import { MIMES_ARCHIVO, subirAGemini } from "@/lib/asistenteIA";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Sube una imagen o un PDF del Asistente IA a la Files API de Gemini.
 *
 *   POST multipart con el campo «archivo» → { uri, mime, nombre }
 *
 * Así, en las preguntas siguientes de la conversación el archivo viaja como
 * una referencia y no se vuelve a mandar entero. Vercel no acepta envíos de
 * más de 4,5 MB, de ahí el tope.
 */

const MAX_BYTES = 4_400_000;
const LIMITE_POR_HORA = 60;
const usos = new Map<string, { veces: number; desde: number }>();

function pasaElLimite(usuario: string): boolean {
  const ahora = Date.now();
  const previo = usos.get(usuario);
  if (!previo || ahora - previo.desde > 3_600_000) {
    usos.set(usuario, { veces: 1, desde: ahora });
    return true;
  }
  if (previo.veces >= LIMITE_POR_HORA) return false;
  previo.veces += 1;
  return true;
}

export async function POST(req: Request) {
  const store = await cookies();
  const sesion = await leerSesion(store.get(COOKIE_ADMIN)?.value, process.env.ADMIN_SECRET);
  if (!sesion) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });

  const formulario = await req.formData().catch(() => null);
  const archivo = formulario?.get("archivo");
  if (!archivo || typeof archivo === "string") {
    return NextResponse.json({ error: "No llegó el archivo." }, { status: 400 });
  }
  if (archivo.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "El archivo pesa más de 4 MB. Comprímelo o divídelo en partes." },
      { status: 413 }
    );
  }
  const mime = archivo.type || "application/octet-stream";
  if (!MIMES_ARCHIVO.includes(mime)) {
    return NextResponse.json({ error: "Ese tipo de archivo no se puede leer aquí." }, { status: 415 });
  }
  if (!pasaElLimite(sesion.usuario)) {
    return NextResponse.json(
      { error: `Llegaste a ${LIMITE_POR_HORA} archivos en una hora. Espera un rato.` },
      { status: 429 }
    );
  }

  const nombre = (archivo.name || "archivo").slice(0, 200);
  const datos = new Uint8Array(await archivo.arrayBuffer());
  const r = await subirAGemini(datos, mime, nombre);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json(r.archivo);
}
