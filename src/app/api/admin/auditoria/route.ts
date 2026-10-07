import { SQL_AUDITORIA } from "@/lib/consultaAuditoria";
import { crearRutaAthena } from "@/lib/rutaAthena";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Auditoría de calidad de datos: corre SQL_AUDITORIA en Athena. Ver lib/rutaAthena.ts. */
const ruta = crearRutaAthena("datos", SQL_AUDITORIA);

export const POST = ruta.POST;
export const GET = ruta.GET;
