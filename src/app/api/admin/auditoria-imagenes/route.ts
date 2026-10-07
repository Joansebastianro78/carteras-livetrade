import { SQL_IMAGENES } from "@/lib/consultaImagenes";
import { crearRutaAthena } from "@/lib/rutaAthena";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Auditoría de imágenes: corre SQL_IMAGENES en Athena. Ver lib/rutaAthena.ts. */
const ruta = crearRutaAthena("imagenes", SQL_IMAGENES);

export const POST = ruta.POST;
export const GET = ruta.GET;
