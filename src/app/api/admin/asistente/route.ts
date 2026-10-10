import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_ADMIN, leerSesion } from "@/lib/auth";
import {
  conversar,
  PREFIJO_ARCHIVO_GEMINI,
  MIMES_ARCHIVO,
  type Adjunto,
  type Evento,
  type ImagenActual,
  type Mensaje,
  type Modo,
} from "@/lib/asistenteIA";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// El modo combinado son tres llamadas a las IA; 5 minutos alcanzan de sobra.
export const maxDuration = 300;

/**
 * Asistente IA. Lo usan los tres perfiles.
 *
 *   POST { modo, mensajes, imagenes? }
 *   → texto plano, una línea de JSON por evento (ver Evento en lib/asistenteIA):
 *     estado, borrador de cada IA, pedazos de la respuesta, fin o error.
 */

const MAX_MENSAJES = 40;
const MAX_TEXTO_MENSAJE = 30_000;
/** Todo el texto de los documentos adjuntos de la conversación. */
const MAX_TEXTO_ADJUNTOS = 400_000;
const MAX_IMAGENES = 6;
/** Base64 de una imagen ya comprimida en el navegador. */
const MAX_IMAGEN = 3_500_000;
const MIMES_IMAGEN_DEEPSEEK = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * Límite por usuario. Cada mensaje en modo combinado son tres llamadas que se
 * pagan, así que un dedo pegado al botón no debería vaciar la cuota del mes.
 * Vive en memoria del proceso: alcanza para esto.
 */
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

function texto(v: unknown, largo: number): string {
  return typeof v === "string" ? v.slice(0, largo) : "";
}

/** Revisa lo que manda el navegador y lo deja solo con lo permitido. */
function limpiar(body: Record<string, unknown>):
  | { ok: true; modo: Modo; mensajes: Mensaje[]; imagenes: ImagenActual[] }
  | { ok: false; error: string } {
  const modo: Modo = body.modo === "gemini" || body.modo === "deepseek" ? body.modo : "combinado";

  const crudos = Array.isArray(body.mensajes) ? body.mensajes.slice(-MAX_MENSAJES) : [];
  let textoAdjuntos = 0;
  const mensajes: Mensaje[] = [];

  for (const c of crudos as Record<string, unknown>[]) {
    const rol = c?.rol === "asistente" ? "asistente" : c?.rol === "usuario" ? "usuario" : null;
    if (!rol) continue;
    const adjuntos: Adjunto[] = [];
    for (const a of (Array.isArray(c.adjuntos) ? c.adjuntos : []) as Record<string, unknown>[]) {
      const nombre = texto(a?.nombre, 200) || "archivo";
      if (a?.tipo === "archivo") {
        const uri = texto(a.uri, 300);
        const mime = texto(a.mime, 80);
        // Solo archivos de la Files API de Gemini: ninguna otra dirección.
        if (!uri.startsWith(PREFIJO_ARCHIVO_GEMINI)) continue;
        if (!/^[a-z0-9_-]{1,80}$/i.test(uri.slice(PREFIJO_ARCHIVO_GEMINI.length))) continue;
        if (!MIMES_ARCHIVO.includes(mime)) continue;
        adjuntos.push({ tipo: "archivo", nombre, mime, uri });
      } else if (a?.tipo === "texto") {
        const contenido = texto(a.contenido, MAX_TEXTO_ADJUNTOS);
        textoAdjuntos += contenido.length;
        if (textoAdjuntos > MAX_TEXTO_ADJUNTOS) {
          return {
            ok: false,
            error: "Los documentos de esta conversación tienen demasiado texto. Empieza una conversación nueva o adjunta menos.",
          };
        }
        adjuntos.push({ tipo: "texto", nombre, contenido });
      }
    }
    mensajes.push({ rol, texto: texto(c.texto, MAX_TEXTO_MENSAJE), adjuntos });
  }

  if (mensajes.length === 0 || mensajes[mensajes.length - 1].rol !== "usuario") {
    return { ok: false, error: "No llegó la pregunta." };
  }
  const ultimo = mensajes[mensajes.length - 1];
  if (!ultimo.texto.trim() && (ultimo.adjuntos ?? []).length === 0) {
    return { ok: false, error: "Escribe una pregunta o adjunta un archivo." };
  }

  const imagenes: ImagenActual[] = [];
  for (const i of (Array.isArray(body.imagenes) ? body.imagenes.slice(0, MAX_IMAGENES) : []) as Record<string, unknown>[]) {
    const mime = texto(i?.mime, 40);
    const datos = texto(i?.datos, MAX_IMAGEN + 1);
    if (!MIMES_IMAGEN_DEEPSEEK.includes(mime) || datos.length > MAX_IMAGEN || !/^[A-Za-z0-9+/=]+$/.test(datos)) continue;
    imagenes.push({ nombre: texto(i.nombre, 200), mime, datos });
  }

  return { ok: true, modo, mensajes, imagenes };
}

export async function POST(req: Request) {
  const store = await cookies();
  const sesion = await leerSesion(store.get(COOKIE_ADMIN)?.value, process.env.ADMIN_SECRET);
  if (!sesion) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "No llegó la pregunta." }, { status: 400 });

  const limpio = limpiar(body);
  if (!limpio.ok) return NextResponse.json({ error: limpio.error }, { status: 400 });

  if (!pasaElLimite(sesion.usuario)) {
    return NextResponse.json(
      { error: `Llegaste a ${LIMITE_POR_HORA} preguntas en una hora. Espera un rato.` },
      { status: 429 }
    );
  }

  const codificador = new TextEncoder();
  // Si la persona toca «Detener» o cierra la página, se cortan las llamadas a las IA.
  const control = new AbortController();
  req.signal.addEventListener("abort", () => control.abort());

  const flujo = new ReadableStream<Uint8Array>({
    async start(salida) {
      const emitir = (e: Evento) => {
        if (control.signal.aborted) return;
        try {
          salida.enqueue(codificador.encode(JSON.stringify(e) + "\n"));
        } catch {
          control.abort();
        }
      };
      try {
        await conversar(limpio.mensajes, limpio.imagenes, limpio.modo, emitir, control.signal);
      } catch (e) {
        console.error("[asistente]", e);
        emitir({ t: "error", mensaje: "Algo falló al responder. Intenta de nuevo." });
      } finally {
        try {
          salida.close();
        } catch {
          // ya estaba cerrada
        }
      }
    },
    cancel() {
      control.abort();
    },
  });

  return new Response(flujo, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Que ningún proxy guarde la respuesta antes de mandarla: se ve en vivo.
      "X-Accel-Buffering": "no",
    },
  });
}
