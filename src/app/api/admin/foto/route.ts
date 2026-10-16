import { NextResponse } from "next/server";
import sharp from "sharp";
import { descargarFoto } from "@/lib/descargaFoto";
import { tipoImagen } from "@/lib/fotosZip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Una foto de la auditoría, traída por el servidor: GET ?url=…
 *
 * La usa la descarga de fotos en ZIP (galerías y Exportador de fotos) cuando
 * el navegador no puede leer los bytes de la foto directamente (el servidor
 * de fotos no lo permite, CORS). La descarga tiene los mismos cuidados que la
 * de las repetidas (lib/descargaFoto.ts): solo http y https, nada de la red
 * interna, hasta 20 MB.
 *
 * Solo se devuelven imágenes de verdad (JPEG, PNG, WebP, GIF, HEIC; se mira
 * el contenido, no lo que diga el servidor), como archivo para descargar y
 * nunca para mostrar: así esta ruta no sirve para publicar otra cosa con la
 * dirección del panel.
 *
 * Vercel no deja responder más de 4,5 MB: una foto más grande se recomprime
 * en JPEG (casi nunca pasa con las fotos del celular).
 */

const TOPE = 4_200_000;

async function achicar(datos: Buffer): Promise<Buffer> {
  for (const [lado, calidad] of [
    [4000, 85],
    [3000, 75],
    [2000, 70],
  ] as const) {
    const salida = await sharp(datos, { failOn: "none", limitInputPixels: 100_000_000 })
      .rotate()
      .resize(lado, lado, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: calidad })
      .toBuffer();
    if (salida.length <= TOPE) return salida;
  }
  throw new Error("sigue grande");
}

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (url.length > 4000 || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "El enlace de la foto no es válido." }, { status: 400 });
  }

  const d = await descargarFoto(url);
  if (!d.ok) return NextResponse.json({ error: d.error }, { status: d.definitivo ? 404 : 502 });

  let datos = d.datos;
  let tipo = tipoImagen(datos);
  if (!tipo) return NextResponse.json({ error: "El enlace no lleva a una imagen." }, { status: 415 });

  let recomprimida = false;
  if (datos.length > TOPE) {
    try {
      datos = await achicar(datos);
      tipo = "image/jpeg";
      recomprimida = true;
    } catch {
      return NextResponse.json({ error: "La foto pesa demasiado y no se pudo achicar." }, { status: 413 });
    }
  }

  return new NextResponse(new Uint8Array(datos), {
    headers: {
      "Content-Type": tipo,
      "Content-Disposition": "attachment",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=600",
      "X-Foto-Recomprimida": recomprimida ? "1" : "0",
    },
  });
}
