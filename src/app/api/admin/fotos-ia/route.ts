import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sesionConPermisos } from "@/lib/perfilesServidor";
import { esTablaFaltante, textoError } from "@/lib/tablaFaltante";
import { descargarFoto } from "@/lib/descargaFoto";
import { fotoParaIA } from "@/lib/huellaVisual";
import { preguntarConImagenes, type ImagenActual } from "@/lib/asistenteIA";
import { nombreModelo } from "@/lib/modelosGemini";
import { FOTOS_POR_PREGUNTA, ILEGIBLE, esEtiquetaLibro, leerEtiquetas, type Vistas } from "@/lib/etiquetasIA";
import { CONTRAPORTADA_LIBRO, PORTADA_LIBRO, VERSION_LIBRO } from "@/lib/referenciaLibro";
import { PATRON_CLAVE, claveDe } from "@/lib/repetidas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Qué se ve en las fotos, según la IA (Auditoría con query). Por POST:
 *
 *   guardadas { claves, etiquetas } → lo que la IA ya dijo de esas fotos
 *   revisar   { urls, etiquetas }   → le muestra hasta 10 fotos a la IA y le
 *                                     pregunta cuáles etiquetas se ven en cada una
 *
 * Usa solo los modelos Flash Lite de Gemini (cientos de peticiones al día),
 * para no gastar el cupo de los Flash, que es el del asistente, y nunca pasa a
 * GPT-4o, que cobra: son miles de fotos. Si los Flash Lite están en su tope
 * por minuto, responde 429 con cuántos segundos esperar. Lo que dice la IA se
 * guarda en etiquetas_fotos (supabase/panel.sql).
 *
 * Con «libro» (o «libros», «libro fiscal»…), la pregunta describe el Libro
 * fiscal de la Cámara de Comercio de Bogotá y lleva dos fotos de referencia,
 * portada y contraportada (lib/referenciaLibro.ts). Lo revisado así se guarda
 * con VERSION_LIBRO; un «no hay libro» guardado sin esa versión (de antes de
 * las referencias) se toma como sin revisar y se vuelve a preguntar. Un «sí
 * hay libro» de antes vale igual: las referencias solo agregan.
 */

const MAX_CLAVES = 1000;
const TROZO = 150;
const A_LA_VEZ = 5;
/** Las fotos van más chicas que para las repetidas: aquí basta con reconocer las cosas. */
const LADO = 640;

const AVISO_SIN_TABLA =
  "Lo que dice la IA no se está guardando: falta ejecutar supabase/panel.sql. Mientras tanto, cada revisión vuelve a preguntar.";

const INSTRUCCION_IA =
  "Eres auditor de fotos de visitas a puntos de venta en Colombia. Miras cada foto y dices cuáles cosas de una lista se ven en ella. Respondes solo con JSON válido.";

function preguntaIA(n: number, etiquetas: string[]): string {
  const libros = etiquetas.filter(esEtiquetaLibro);
  return `Te paso ${n} fotos numeradas de 1 a ${n}.
Para cada foto, di cuáles de estas cosas se ven claramente en ella: ${etiquetas.map((e) => `"${e}"`).join(", ")}.
Usa exactamente esas palabras. Si no se ve ninguna, deja la lista vacía. Marca "ilegible": true si la foto está tan borrosa, oscura o cortada que no se puede saber.${
    libros.length ? `\n${textoLibro(libros)}` : ""
  }
Responde solo con este JSON, sin texto antes ni después:
{"fotos":[{"numero":1,"ve":["${etiquetas[0]}"],"ilegible":false}]}`;
}

/** Cómo es el libro fiscal de la CCB, para las etiquetas de libro. */
function textoLibro(libros: string[]): string {
  const cuales = libros.map((e) => `"${e}"`).join(" y ");
  return `Ojo con ${cuales}: también cuenta el Libro fiscal de registro de operaciones diarias de la Cámara de Comercio de Bogotá, que se les entrega a los puntos de venta. Es un libro grande y delgado, más ancho que alto. La portada tiene una franja roja con el logo de la Cámara de Comercio de Bogotá y el título "Libro fiscal de registro de operaciones diarias", junto a la foto de una comerciante en su negocio. La contraportada tiene una franja roja con "Renueva tu matrícula mercantil hasta el 31 de marzo" y la foto de un comerciante en un café. Antes de las fotos van dos imágenes de referencia de ese libro, la portada y la contraportada: no son fotos para revisar ni llevan número. Si en una foto se ve ese libro, por cualquiera de sus dos caras, de frente, de lado, de lejos, en la mano de alguien o tapado en parte, incluye ${cuales} aunque parezca un afiche o se vea una persona en la pasta.`;
}

const REFERENCIAS_LIBRO = [
  { rotulo: "Referencia: portada del libro fiscal (no es una foto para revisar).", imagen: { nombre: "libro-portada.jpg", mime: "image/jpeg", datos: PORTADA_LIBRO } },
  {
    rotulo: "Referencia: contraportada del libro fiscal (no es una foto para revisar).",
    imagen: { nombre: "libro-contraportada.jpg", mime: "image/jpeg", datos: CONTRAPORTADA_LIBRO },
  },
];

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

/** La etiqueta pedida que corresponde a lo que dijo la IA («libro fiscal» cuenta como «libro»). */
function etiquetaDe(dicho: unknown, etiquetas: string[]): string | null {
  if (typeof dicho !== "string") return null;
  const d = dicho.trim().toLowerCase();
  return etiquetas.find((e) => d === e) ?? etiquetas.find((e) => d.includes(e) || e.includes(d)) ?? null;
}

/** Del texto de la IA: qué vio en cada foto (por número). null si no se entiende. */
function leerRespuesta(texto: string, n: number, etiquetas: string[]): Map<number, Vistas> | null {
  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio < 0 || fin <= inicio) return null;
  try {
    const j = JSON.parse(texto.slice(inicio, fin + 1)) as { fotos?: unknown };
    if (!Array.isArray(j.fotos)) return null;
    const salida = new Map<number, Vistas>();
    for (const f of j.fotos as Record<string, unknown>[]) {
      const numero = Number(f?.numero);
      if (!Number.isInteger(numero) || numero < 1 || numero > n) continue;
      const vistas = new Set((Array.isArray(f.ve) ? f.ve : []).map((x) => etiquetaDe(x, etiquetas)).filter(Boolean));
      const v: Vistas = {};
      for (const e of etiquetas) v[e] = vistas.has(e);
      v[ILEGIBLE] = f.ilegible === true;
      salida.set(numero, v);
    }
    return salida.size > 0 ? salida : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ acciones

async function guardadas(claves: unknown, etiquetas: string[]) {
  if (!Array.isArray(claves) || claves.length > MAX_CLAVES || !claves.every((c) => typeof c === "string" && PATRON_CLAVE.test(c))) {
    return json({ error: "Lista de fotos no válida." }, 400);
  }
  const buscadas = [...etiquetas, ILEGIBLE];
  const resultados: Record<string, Vistas> = {};
  for (let i = 0; i < claves.length; i += TROZO) {
    const { data, error, status } = await supabaseAdmin
      .from("etiquetas_fotos")
      .select("clave,etiqueta,presente,ia")
      .in("clave", (claves as string[]).slice(i, i + TROZO))
      .in("etiqueta", buscadas);
    if (error) {
      console.error("[fotos-ia guardadas]", textoError(error, status));
      if (esTablaFaltante(error, status)) return json({ resultados: {}, aviso: AVISO_SIN_TABLA });
      return json({ error: "No se pudo leer lo que ya dijo la IA." }, 500);
    }
    for (const f of (data ?? []) as { clave: string; etiqueta: string; presente: boolean; ia: string | null }[]) {
      // Un «no hay libro» de antes de las fotos de referencia no vale: se vuelve a preguntar.
      if (esEtiquetaLibro(f.etiqueta) && !f.presente && !(f.ia ?? "").includes(VERSION_LIBRO)) continue;
      (resultados[f.clave] ??= {})[f.etiqueta] = f.presente;
    }
  }
  return json({ resultados, aviso: null });
}

async function revisar(urls: unknown, etiquetas: string[], usuario: string) {
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > FOTOS_POR_PREGUNTA || !urls.every(enlaceValido)) {
    return json({ error: "Lista de fotos no válida." }, 400);
  }

  const descargas = await enParalelo(urls as string[], A_LA_VEZ, async (url) => {
    const d = await descargarFoto(url);
    if (!d.ok) return { url, error: d.error };
    try {
      return { url, datos: await fotoParaIA(d.datos, LADO) };
    } catch {
      return { url, error: "El archivo no se pudo leer como imagen." };
    }
  });
  const fallidas: Record<string, string> = {};
  const listas: { url: string; datos: string }[] = [];
  for (const d of descargas) {
    if ("datos" in d && d.datos) listas.push({ url: d.url, datos: d.datos });
    else fallidas[d.url] = d.error ?? "No se pudo descargar.";
  }
  if (listas.length === 0) return json({ resultados: {}, fallidas, aviso: null });

  const imagenes: ImagenActual[] = listas.map((x, i) => ({ nombre: `foto-${i + 1}.jpg`, mime: "image/jpeg", datos: x.datos }));
  const conLibro = etiquetas.some(esEtiquetaLibro);
  const r = await preguntarConImagenes(INSTRUCCION_IA, preguntaIA(imagenes.length, etiquetas), imagenes, AbortSignal.timeout(50_000), {
    preferido: process.env.GEMINI_MODELO_FOTOS || "gemini-3.5-flash-lite",
    familias: ["lite"],
    sinRespaldo: true,
    referencias: conLibro ? REFERENCIAS_LIBRO : undefined,
  });
  if (!r.ok) {
    const espera = r.esperaMs ? Math.ceil(r.esperaMs / 1000) : null;
    // Más de unos minutos es el cupo del día: se dice a qué hora vuelve.
    const error =
      espera && espera > 180
        ? `Se acabó por hoy el cupo de Gemini para revisar fotos. Se libera hacia las ${new Intl.DateTimeFormat("es-CO", {
            timeZone: "America/Bogota",
            hour: "numeric",
            minute: "2-digit",
          }).format(new Date(Date.now() + espera * 1000))} (hora de Colombia); lo que ya se revisó queda guardado.`
        : r.error;
    return json({ error, esperarSegundos: espera }, espera ? 429 : 502);
  }

  const leida = leerRespuesta(r.texto, imagenes.length, etiquetas);
  if (!leida) {
    console.error("[fotos-ia] respuesta sin el formato esperado:", r.texto.slice(0, 300));
    return json({ error: "La IA no respondió en el formato esperado. Intenta de nuevo." }, 502);
  }

  const modelo = r.modelo ? `Gemini ${nombreModelo(r.modelo)}` : "IA";
  const resultados: Record<string, Vistas> = {};
  const filas: { clave: string; etiqueta: string; presente: boolean; ia: string }[] = [];
  listas.forEach((x, i) => {
    const v = leida.get(i + 1);
    if (!v) return;
    const clave = claveDe(x.url);
    resultados[clave] = v;
    const ia = conLibro ? `${modelo} · ${VERSION_LIBRO}` : modelo;
    for (const [etiqueta, presente] of Object.entries(v)) filas.push({ clave, etiqueta, presente, ia });
  });

  let aviso: string | null = null;
  if (filas.length > 0) {
    const { error, status } = await supabaseAdmin.from("etiquetas_fotos").upsert(filas, { onConflict: "clave,etiqueta" });
    if (error) {
      console.error("[fotos-ia guardar]", textoError(error, status));
      if (esTablaFaltante(error, status)) aviso = AVISO_SIN_TABLA;
    }
  }
  console.info(`[fotos-ia] ${usuario}: ${Object.keys(resultados).length} foto(s) con ${modelo}`);
  return json({ resultados, fallidas, aviso, modelo });
}

export async function POST(req: Request) {
  const sesion = await sesionConPermisos();
  if (!sesion) return json({ error: "Sesión no válida o expirada." }, 401);

  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const etiquetas = leerEtiquetas(Array.isArray(body.etiquetas) ? body.etiquetas.join(",") : body.etiquetas);
  if (etiquetas.length === 0) return json({ error: "Escribe qué buscar en las fotos (por ejemplo: libro, afiche)." }, 400);

  try {
    switch (body.accion) {
      case "guardadas":
        return await guardadas(body.claves, etiquetas);
      case "revisar":
        return await revisar(body.urls, etiquetas, sesion.usuario);
      default:
        return json({ error: "Acción no válida." }, 400);
    }
  } catch (e) {
    console.error("[fotos-ia]", (e as Error).message);
    return json({ error: "No se pudo completar. Intenta de nuevo." }, 500);
  }
}
