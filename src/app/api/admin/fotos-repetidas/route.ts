import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sesionConPermisos } from "@/lib/perfilesServidor";
import { esTablaFaltante, textoError } from "@/lib/tablaFaltante";
import { descargarFoto } from "@/lib/descargaFoto";
import { fotoParaIA, sacarHuella } from "@/lib/huellaVisual";
import { preguntarConImagenes, type ImagenActual } from "@/lib/asistenteIA";
import { PATRON_CLAVE, claveDe, clavePar, type InfoHuella, type Veredicto } from "@/lib/repetidas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Fotos repetidas de la Auditoría con query. Todo va por POST con una acción:
 *
 *   guardadas  { claves }              → las huellas ya guardadas de esas fotos
 *   sacar      { urls }                → descarga las fotos, saca y guarda su huella
 *   veredictos { pares }               → lo que ya dijo la IA de esos pares
 *   confirmar  { referencia, otras }   → le pregunta a la IA si las otras son la
 *                                        misma foto que la referencia
 *
 * Las claves son la huella del enlace (lib/revisionFotos.ts), como en las
 * marcas de las fotos. Las huellas y los veredictos se guardan en
 * huellas_fotos y repetidas_ia (supabase/panel.sql); sin esas tablas todo
 * funciona, pero se vuelve a descargar y a preguntar cada vez.
 */

const MAX_CLAVES = 1000;
const MAX_URLS = 12;
const MAX_OTRAS = 5;
const MAX_PARES = 1000;
const A_LA_VEZ = 6;
const TROZO = 150;

const AVISO_SIN_TABLA =
  "Las huellas no se están guardando: falta ejecutar supabase/panel.sql. Mientras tanto, cada búsqueda vuelve a descargar las fotos.";

const INSTRUCCION_IA =
  "Eres auditor de fotos de visitas a puntos de venta en Colombia. Comparas fotos para saber si un consultor reutilizó la misma fotografía en visitas distintas. Respondes solo con JSON válido.";

function preguntaIA(n: number): string {
  return `Te paso ${n} fotos de visitas distintas, numeradas de 1 a ${n}. La foto 1 es la de referencia.
Para cada foto de la 2 a la ${n}, di si es LA MISMA FOTOGRAFÍA que la 1: la misma toma, aunque esté recortada, girada, con otro brillo o color, con otra resolución o comprimida. Si es otra toma, aunque muestre el mismo objeto, el mismo lugar o un encuadre parecido, NO es la misma. Fíjate en lo que solo coincide en la misma toma: reflejos, sombras, objetos al fondo, la posición exacta de cada cosa, arrugas y marcas.
Responde solo con este JSON, sin texto antes ni después:
{"fotos":[{"numero":2,"misma":true,"motivo":"una frase corta en español"}]}`;
}

const json = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status });

function enlaceValido(u: unknown): u is string {
  if (typeof u !== "string" || u.length > 4000 || !/^https?:\/\//i.test(u)) return false;
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function enParalelo<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const salida = new Array<R>(items.length);
  let siguiente = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (siguiente < items.length) {
        const i = siguiente++;
        salida[i] = await fn(items[i]);
      }
    })
  );
  return salida;
}

/** Lee de a pedazos una tabla por su llave. null si falta la tabla. */
async function leerPor<T>(tabla: string, columnas: string, llave: string, valores: string[]): Promise<T[] | null> {
  const filas: T[] = [];
  for (let i = 0; i < valores.length; i += TROZO) {
    const { data, error, status } = await supabaseAdmin.from(tabla).select(columnas).in(llave, valores.slice(i, i + TROZO));
    if (error) {
      console.error(`[fotos-repetidas ${tabla}]`, textoError(error, status));
      if (esTablaFaltante(error, status)) return null;
      throw new Error("lectura");
    }
    filas.push(...((data ?? []) as T[]));
  }
  return filas;
}

// ------------------------------------------------------------------ acciones

async function guardadas(claves: unknown) {
  if (!Array.isArray(claves) || claves.length > MAX_CLAVES || !claves.every((c) => typeof c === "string" && PATRON_CLAVE.test(c))) {
    return json({ error: "Lista de fotos no válida." }, 400);
  }
  const filas = await leerPor<{ clave: string; huella: string | null; plana: boolean; error: string | null }>(
    "huellas_fotos",
    "clave,huella,plana,error",
    "clave",
    claves as string[]
  );
  if (filas === null) return json({ huellas: {}, aviso: AVISO_SIN_TABLA });
  const huellas: Record<string, InfoHuella> = {};
  for (const f of filas) huellas[f.clave] = { huella: f.huella, plana: f.plana, error: f.error };
  return json({ huellas, aviso: null });
}

async function sacar(urls: unknown) {
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > MAX_URLS || !urls.every(enlaceValido)) {
    return json({ error: "Lista de fotos no válida." }, 400);
  }
  const resultados = await enParalelo(urls as string[], A_LA_VEZ, async (url) => {
    const clave = claveDe(url);
    const d = await descargarFoto(url);
    if (!d.ok) return { clave, info: { huella: null, plana: false, error: d.error }, guardar: d.definitivo };
    try {
      const h = await sacarHuella(d.datos);
      return { clave, info: { huella: h.huella, plana: h.plana, error: null }, guardar: true };
    } catch {
      return { clave, info: { huella: null, plana: false, error: "El archivo no se pudo leer como imagen." }, guardar: true };
    }
  });

  let aviso: string | null = null;
  const filas = resultados.filter((r) => r.guardar).map((r) => ({ clave: r.clave, ...r.info }));
  if (filas.length > 0) {
    const { error, status } = await supabaseAdmin.from("huellas_fotos").upsert(filas, { onConflict: "clave" });
    if (error) {
      console.error("[fotos-repetidas guardar]", textoError(error, status));
      if (esTablaFaltante(error, status)) aviso = AVISO_SIN_TABLA;
    }
  }
  const huellas: Record<string, InfoHuella> = {};
  for (const r of resultados) huellas[r.clave] = r.info;
  return json({ huellas, aviso });
}

const PATRON_PAR = /^f[0-9a-z]{4,24}\|f[0-9a-z]{4,24}$/;

async function veredictos(pares: unknown) {
  if (!Array.isArray(pares) || pares.length > MAX_PARES || !pares.every((p) => typeof p === "string" && PATRON_PAR.test(p))) {
    return json({ error: "Lista de pares no válida." }, 400);
  }
  const filas = await leerPor<{ par: string; misma: boolean; motivo: string | null; ia: string | null }>(
    "repetidas_ia",
    "par,misma,motivo,ia",
    "par",
    pares as string[]
  );
  const salida: Record<string, Veredicto> = {};
  for (const f of filas ?? []) salida[f.par] = { misma: f.misma, motivo: f.motivo ?? "", ia: f.ia ?? "" };
  return json({ veredictos: salida });
}

/** Saca del texto de la IA el JSON de las fotos. null si no se entiende. */
function leerRespuesta(texto: string, n: number): Map<number, { misma: boolean; motivo: string }> | null {
  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio < 0 || fin <= inicio) return null;
  try {
    const j = JSON.parse(texto.slice(inicio, fin + 1)) as { fotos?: unknown };
    if (!Array.isArray(j.fotos)) return null;
    const salida = new Map<number, { misma: boolean; motivo: string }>();
    for (const f of j.fotos as Record<string, unknown>[]) {
      const numero = Number(f?.numero);
      if (!Number.isInteger(numero) || numero < 2 || numero > n || typeof f.misma !== "boolean") continue;
      salida.set(numero, { misma: f.misma, motivo: String(f.motivo ?? "").replace(/\s+/g, " ").trim().slice(0, 240) });
    }
    return salida.size > 0 ? salida : null;
  } catch {
    return null;
  }
}

async function confirmar(referencia: unknown, otras: unknown, usuario: string) {
  if (
    !enlaceValido(referencia) ||
    !Array.isArray(otras) ||
    otras.length === 0 ||
    otras.length > MAX_OTRAS ||
    !otras.every(enlaceValido) ||
    otras.includes(referencia)
  ) {
    return json({ error: "Fotos no válidas para comparar." }, 400);
  }
  const claveRef = claveDe(referencia);
  const pares = (otras as string[]).map((o) => clavePar(claveRef, claveDe(o)));

  // Lo que ya se le preguntó a la IA no se vuelve a pagar.
  const ya = await leerPor<{ par: string; misma: boolean; motivo: string | null; ia: string | null }>(
    "repetidas_ia",
    "par,misma,motivo,ia",
    "par",
    pares
  );
  const salida: Record<string, Veredicto> = {};
  for (const f of ya ?? []) salida[f.par] = { misma: f.misma, motivo: f.motivo ?? "", ia: f.ia ?? "" };
  const faltan = (otras as string[]).filter((_, i) => !salida[pares[i]]);
  if (faltan.length === 0) return json({ veredictos: salida, fallidas: {} });

  const descargas = await enParalelo([referencia, ...faltan], A_LA_VEZ, async (url) => {
    const d = await descargarFoto(url);
    if (!d.ok) return { url, error: d.error };
    try {
      return { url, datos: await fotoParaIA(d.datos) };
    } catch {
      return { url, error: "El archivo no se pudo leer como imagen." };
    }
  });
  const [ref, ...resto] = descargas;
  if (!("datos" in ref)) return json({ error: `No se pudo descargar la foto de referencia: ${ref.error}` }, 502);

  const fallidas: Record<string, string> = {};
  const listas: { url: string; datos: string }[] = [];
  for (const r of resto) {
    if ("datos" in r) listas.push(r as { url: string; datos: string });
    else fallidas[r.url] = r.error ?? "No se pudo descargar.";
  }
  if (listas.length === 0) return json({ veredictos: salida, fallidas });

  const imagenes: ImagenActual[] = [ref as { url: string; datos: string }, ...listas].map((x, i) => ({
    nombre: `foto-${i + 1}.jpg`,
    mime: "image/jpeg",
    datos: x.datos,
  }));
  const r = await preguntarConImagenes(INSTRUCCION_IA, preguntaIA(imagenes.length), imagenes, AbortSignal.timeout(50_000));
  if (!r.ok) return json({ error: r.error }, 502);

  const leida = leerRespuesta(r.texto, imagenes.length);
  if (!leida) {
    console.error("[fotos-repetidas ia] respuesta sin el formato esperado:", r.texto.slice(0, 300));
    return json({ error: "La IA no respondió en el formato esperado. Intenta de nuevo." }, 502);
  }

  const nombreIA = r.ia === "gemini" ? "Gemini" : "GPT-4o";
  const nuevas: { par: string; misma: boolean; motivo: string; ia: string; pedido_por: string }[] = [];
  listas.forEach((x, i) => {
    const v = leida.get(i + 2);
    if (!v) return;
    const par = clavePar(claveRef, claveDe(x.url));
    salida[par] = { misma: v.misma, motivo: v.motivo, ia: nombreIA };
    nuevas.push({ par, misma: v.misma, motivo: v.motivo, ia: nombreIA, pedido_por: usuario });
  });
  if (nuevas.length > 0) {
    const { error, status } = await supabaseAdmin.from("repetidas_ia").upsert(nuevas, { onConflict: "par" });
    if (error) console.error("[fotos-repetidas guardar ia]", textoError(error, status));
  }
  console.info(`[fotos-repetidas] ${usuario} confirmó ${nuevas.length} par(es) con ${nombreIA}`);
  return json({ veredictos: salida, fallidas });
}

export async function POST(req: Request) {
  const sesion = await sesionConPermisos();
  if (!sesion) return json({ error: "Sesión no válida o expirada." }, 401);

  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  try {
    switch (body.accion) {
      case "guardadas":
        return await guardadas(body.claves);
      case "sacar":
        return await sacar(body.urls);
      case "veredictos":
        return await veredictos(body.pares);
      case "confirmar":
        return await confirmar(body.referencia, body.otras, sesion.usuario);
      default:
        return json({ error: "Acción no válida." }, 400);
    }
  } catch (e) {
    console.error("[fotos-repetidas]", (e as Error).message);
    return json({ error: "No se pudo completar. Intenta de nuevo." }, 500);
  }
}
