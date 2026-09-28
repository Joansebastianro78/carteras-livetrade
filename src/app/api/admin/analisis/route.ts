import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_ADMIN, leerSesion } from "@/lib/auth";
import { analizarConGemini, type ParteAnalisis } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Imagen ya en base64: 6 MB de texto son unos 4,5 MB de archivo. */
const TOPE_IMAGEN = 6_000_000;
const TOPE_TEXTO = 60_000;

const MIMES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Límite por usuario. Cada análisis cuesta plata en Google, así que un dedo
 * pegado al botón no debería vaciar la cuota del mes. Vive en memoria: se
 * reinicia con el servidor, y para esto alcanza.
 */
const LIMITE_POR_HORA = 20;
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
  const sesion = await leerSesion(
    store.get(COOKIE_ADMIN)?.value,
    process.env.ADMIN_SECRET
  );

  if (!sesion) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  }

  if (!pasaElLimite(sesion.usuario)) {
    return NextResponse.json(
      { error: `Llegaste a ${LIMITE_POR_HORA} análisis en una hora. Espera un rato.` },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    /** Data URL: "data:image/png;base64,…" */
    imagen?: string;
    /** Datos pegados del tablero (una tabla, un export). */
    datos?: string;
    /** Pregunta puntual, opcional. */
    pregunta?: string;
    /** Nombre del tablero, para darle contexto al modelo. */
    tablero?: string;
  };

  const partes: ParteAnalisis[] = [];

  const encabezado = [
    body.tablero ? `Tablero: ${body.tablero}.` : null,
    body.pregunta?.trim()
      ? `Pregunta concreta de quien consulta: ${body.pregunta.trim()}`
      : "No hay pregunta concreta: haz el análisis general.",
  ]
    .filter(Boolean)
    .join("\n");

  partes.push({ texto: encabezado });

  if (body.imagen) {
    const coincide = body.imagen.match(/^data:([^;]+);base64,(.+)$/);
    if (!coincide) {
      return NextResponse.json({ error: "La imagen no es válida." }, { status: 400 });
    }

    const [, mimeType, datos] = coincide;
    if (!MIMES.includes(mimeType)) {
      return NextResponse.json(
        { error: "La imagen debe ser PNG, JPG o WebP." },
        { status: 400 }
      );
    }
    if (datos.length > TOPE_IMAGEN) {
      return NextResponse.json(
        { error: "La imagen pesa demasiado. Recorta la captura e inténtalo de nuevo." },
        { status: 400 }
      );
    }

    partes.push({ imagen: { mimeType, datos } });
  }

  const datosPegados = (body.datos ?? "").trim();
  if (datosPegados) {
    if (datosPegados.length > TOPE_TEXTO) {
      return NextResponse.json(
        { error: "Son demasiados datos pegados. Manda un resumen o menos filas." },
        { status: 400 }
      );
    }
    partes.push({ texto: `Datos del tablero:\n${datosPegados}` });
  }

  if (partes.length === 1) {
    return NextResponse.json(
      { error: "Sube una captura del tablero o pega los datos que quieres analizar." },
      { status: 400 }
    );
  }

  const resultado = await analizarConGemini(partes);

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true, texto: resultado.texto });
}
