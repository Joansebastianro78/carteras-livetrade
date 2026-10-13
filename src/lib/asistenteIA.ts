/**
 * Asistente IA del panel: Groq (principal) y Gemini (secundaria). SOLO SERVIDOR.
 *
 * Las llaves viven en el entorno (GROQ_API_KEY y GEMINI_API_KEY) y nunca
 * llegan al navegador: si estuvieran en el cliente, cualquiera las sacaría del
 * código de la página y las gastaría por su cuenta.
 *
 * Modo combinado (el de siempre):
 *   1. Groq y Gemini escriben cada uno un borrador, al mismo tiempo.
 *   2. Groq los compara y escribe la respuesta final: toma lo mejor de cada
 *      uno y corrige lo que no cuadre. Si en la conversación hay algo que Groq
 *      no ve (un PDF, una imagen de un mensaje anterior), la escribe Gemini.
 * Si una de las dos falla, la respuesta sale de la otra y se avisa. Lo mismo
 * en «Solo Groq» y «Solo Gemini»: si la elegida falla, responde la otra.
 */

const URL_GEMINI = "https://generativelanguage.googleapis.com";
const URL_GROQ = "https://api.groq.com/openai/v1";

/** Prefijo de los archivos subidos a Gemini: es lo único que se acepta como archivo. */
export const PREFIJO_ARCHIVO_GEMINI = `${URL_GEMINI}/v1beta/files/`;

/**
 * Modelos por defecto (octubre de 2026). Se cambian sin tocar código con
 * GEMINI_MODELO_CHAT, GROQ_MODELO y GROQ_MODELO_VISION.
 * - openai/gpt-oss-120b: el modelo de producción más capaz de Groq (solo texto).
 * - qwen/qwen3.8-27b: el único de Groq que ve imágenes (está en vista previa).
 */
export const MODELO_GEMINI = "gemini-3.8-flash";
export const MODELO_GROQ = "openai/gpt-oss-120b";
export const MODELO_GROQ_VISION = "qwen/qwen3.8-27b";
/** Groq acepta hasta 3 imágenes por mensaje. */
const MAX_IMAGENES_GROQ = 3;

export type Modo = "combinado" | "groq" | "gemini";
export type IA = "groq" | "gemini";

const NOMBRE: Record<IA, string> = { groq: "Groq", gemini: "Gemini" };

export type Adjunto =
  /** Imagen o PDF ya subido a Gemini (vence a las 48 horas). */
  | { tipo: "archivo"; nombre: string; mime: string; uri: string }
  /** Texto sacado en el navegador de un Word, Excel, PowerPoint, CSV… */
  | { tipo: "texto"; nombre: string; contenido: string };

export type Mensaje = {
  rol: "usuario" | "asistente";
  texto: string;
  adjuntos?: Adjunto[];
};

/** Imágenes del último mensaje en base64, para Groq (Gemini las ve por su uri). */
export type ImagenActual = { nombre: string; mime: string; datos: string };

export type Resultado = { ok: true; texto: string } | { ok: false; error: string };

/** Lo que va saliendo hacia el navegador, una línea de JSON por evento. */
export type Evento =
  | { t: "estado"; texto: string }
  | { t: "borrador"; ia: IA; texto?: string; error?: string }
  | { t: "texto"; texto: string }
  | { t: "fin"; fuentes: IA[]; aviso?: string }
  | { t: "error"; mensaje: string };

// ------------------------------------------------------------------ instrucciones

function hoy(): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());
}

function instruccionBase(): string {
  return `Eres el asistente de inteligencia artificial del equipo de Overall Colombia que maneja la cartera LiveTrade (puntos de venta, consultores de campo, rutas, auditorías y tableros de Power BI). Ayudas con cualquier tema: preguntas generales, redacción, Excel, SQL, Python, cálculos, ideas y análisis de documentos e imágenes.

Hoy es ${hoy()} (hora de Colombia).

Cómo respondes:
- En español de Colombia, salvo que te pidan otro idioma. Directo y claro, sin rodeos.
- Con Markdown cuando ayuda a leer: títulos cortos, listas, tablas, y bloques de código con su lenguaje.
- Si hay archivos adjuntos, te basas en lo que dicen: cita cifras y textos exactos; si algo no se lee o no está, lo dices.
- No inventas datos, cifras, fuentes ni enlaces. Si no sabes algo o no estás seguro, lo dices.
- No repites números de cédula, teléfonos ni datos personales completos de terceros si no hace falta para la tarea.`;
}

const INSTRUCCION_SINTESIS = `

Ahora trabajas como editor final. Dos asistentes (A y B) ya escribieron un borrador de respuesta al último mensaje del usuario; los verás al final, después de la conversación y de los archivos.
Escribe tú la mejor respuesta final para el usuario:
- Toma lo correcto y útil de cada borrador y deja por fuera lo flojo, lo repetido o lo que sobra.
- Si se contradicen, verifica contra los archivos y tu propio conocimiento y quédate con lo correcto; si no se puede saber, dilo.
- Corrige errores de cálculo, de datos o de lectura de los archivos.
- Uno de los asistentes pudo no ver los archivos: en lo que diga de ellos, manda lo que tú ves.
- No menciones los borradores, ni que hubo dos asistentes, ni a Groq o Gemini.
- Responde directamente al usuario, en el mismo idioma y con el formato que mejor sirva. No más largo de lo necesario.`;

// ------------------------------------------------------------------ Gemini

/**
 * Google cambió el formato de las llaves de AI Studio: las nuevas empiezan
 * por «AQ.». La documentación las manda en la cabecera x-goog-api-key, pero
 * hay cuentas en las que esa vía responde 401 ACCESS_TOKEN_TYPE_UNSUPPORTED.
 * Si pasa con una llave AQ., se reintenta como Authorization: Bearer y se
 * recuerda cuál funcionó.
 */
let formaLlaveGemini: "cabecera" | "bearer" | null = null;

async function pedirGemini(
  ruta: string,
  init: { method: string; headers?: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal }
): Promise<Response> {
  const clave = process.env.GEMINI_API_KEY ?? "";
  const ir = (forma: "cabecera" | "bearer") =>
    fetch(ruta.startsWith("http") ? ruta : URL_GEMINI + ruta, {
      method: init.method,
      body: init.body as BodyInit | undefined,
      signal: init.signal,
      cache: "no-store",
      headers: {
        ...init.headers,
        ...(forma === "bearer" ? { Authorization: `Bearer ${clave}` } : { "x-goog-api-key": clave }),
      },
    });

  const primera = formaLlaveGemini ?? "cabecera";
  const respuesta = await ir(primera);
  if (respuesta.ok) {
    formaLlaveGemini = primera;
    return respuesta;
  }
  if (
    (respuesta.status === 401 || respuesta.status === 403) &&
    formaLlaveGemini === null &&
    clave.startsWith("AQ.")
  ) {
    const otra = await ir("bearer");
    if (otra.ok) formaLlaveGemini = "bearer";
    if (otra.ok || (otra.status !== 401 && otra.status !== 403)) return otra;
  }
  return respuesta;
}

/** Explica en palabras un error de Gemini. */
async function errorGemini(respuesta: Response, modelo: string): Promise<string> {
  const json = await respuesta.json().catch(() => null);
  const detalle: string = json?.error?.message ?? `HTTP ${respuesta.status}`;
  console.error("[asistente gemini]", respuesta.status, detalle);

  if (respuesta.status === 401 || respuesta.status === 403) {
    const llave = process.env.GEMINI_API_KEY ?? "";
    return llave.startsWith("AQ.")
      ? "Gemini rechazó la llave. Las llaves nuevas de Google (empiezan por «AQ.») todavía no funcionan con la API en algunas cuentas: prueba con una llave creada en un proyecto de Google Cloud con facturación activa."
      : "Gemini rechazó la llave (GEMINI_API_KEY). Revisa que esté bien copiada y activa.";
  }
  if (respuesta.status === 404) {
    return `Tu cuenta de Google no tiene el modelo «${modelo}». Cambia GEMINI_MODELO_CHAT por uno disponible.`;
  }
  if (respuesta.status === 429) return "Se agotó por ahora la cuota de Gemini. Espera un momento y vuelve a intentar.";
  if (respuesta.status === 413) return "El mensaje es demasiado grande para Gemini. Quita algún archivo.";
  if (respuesta.status >= 500) return "Gemini está fallando en este momento. Intenta de nuevo en un rato.";
  return `Gemini respondió con un error: ${detalle}`;
}

type ParteGemini =
  | { text: string }
  | { file_data: { mime_type: string; file_uri: string } };

function textoAdjunto(a: Extract<Adjunto, { tipo: "texto" }>): string {
  return `Archivo adjunto «${a.nombre}»:\n"""\n${a.contenido}\n"""`;
}

/** La conversación en el formato de Gemini. */
function contenidosGemini(mensajes: Mensaje[]) {
  return mensajes.map((m) => {
    const partes: ParteGemini[] = [];
    for (const a of m.adjuntos ?? []) {
      if (a.tipo === "archivo") partes.push({ file_data: { mime_type: a.mime, file_uri: a.uri } });
      else partes.push({ text: textoAdjunto(a) });
    }
    partes.push({ text: m.texto || (m.rol === "usuario" ? "(Sin texto: mira los archivos.)" : "…") });
    return { role: m.rol === "usuario" ? "user" : "model", parts: partes };
  });
}

function textoDeRespuestaGemini(json: unknown): string {
  const j = json as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  return (j?.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
}

function motivoVacioGemini(json: unknown): string {
  const j = json as { candidates?: { finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  const motivo = j?.promptFeedback?.blockReason ?? j?.candidates?.[0]?.finishReason;
  return motivo === "SAFETY" || motivo === "PROHIBITED_CONTENT" || motivo === "BLOCKLIST"
    ? "Gemini no respondió por sus filtros de contenido."
    : "Gemini no devolvió texto.";
}

function cuerpoGemini(mensajes: Mensaje[], instruccion: string, extra?: string) {
  const contents = contenidosGemini(mensajes);
  if (extra) contents[contents.length - 1].parts.push({ text: extra });
  return JSON.stringify({
    systemInstruction: { parts: [{ text: instruccion }] },
    contents,
    generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
  });
}

function modeloGemini() {
  return process.env.GEMINI_MODELO_CHAT || MODELO_GEMINI;
}

/** Respuesta completa de Gemini, de una vez. */
async function gemini(mensajes: Mensaje[], instruccion: string, signal: AbortSignal): Promise<Resultado> {
  const modelo = modeloGemini();
  let respuesta: Response;
  try {
    respuesta = await pedirGemini(`/v1beta/models/${modelo}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: cuerpoGemini(mensajes, instruccion),
      signal,
    });
  } catch (e) {
    console.error("[asistente gemini] red", e);
    return { ok: false, error: signal.aborted ? "Se canceló." : "No se pudo contactar a Gemini." };
  }
  if (!respuesta.ok) return { ok: false, error: await errorGemini(respuesta, modelo) };
  const json = await respuesta.json().catch(() => null);
  const texto = textoDeRespuestaGemini(json).trim();
  return texto ? { ok: true, texto } : { ok: false, error: motivoVacioGemini(json) };
}

/** Respuesta de Gemini por partes, a medida que la escribe. */
async function geminiEnVivo(
  mensajes: Mensaje[],
  instruccion: string,
  extra: string | undefined,
  alEscribir: (texto: string) => void,
  signal: AbortSignal
): Promise<Resultado> {
  const modelo = modeloGemini();
  let respuesta: Response;
  try {
    respuesta = await pedirGemini(`/v1beta/models/${modelo}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: cuerpoGemini(mensajes, instruccion, extra),
      signal,
    });
  } catch (e) {
    console.error("[asistente gemini] red", e);
    return { ok: false, error: signal.aborted ? "Se canceló." : "No se pudo contactar a Gemini." };
  }
  if (!respuesta.ok || !respuesta.body) return { ok: false, error: await errorGemini(respuesta, modelo) };

  let todo = "";
  let ultimo: unknown = null;
  try {
    for await (const datos of eventosSSE(respuesta.body)) {
      const json = JSON.parse(datos);
      ultimo = json;
      const texto = textoDeRespuestaGemini(json);
      if (texto) {
        todo += texto;
        alEscribir(texto);
      }
    }
  } catch (e) {
    if (signal.aborted) return { ok: false, error: "Se canceló." };
    console.error("[asistente gemini] corte", e);
    if (!todo) return { ok: false, error: "Gemini cortó la respuesta. Intenta de nuevo." };
  }
  return todo.trim() ? { ok: true, texto: todo } : { ok: false, error: motivoVacioGemini(ultimo) };
}

// ------------------------------------------------------------------ Groq

type ParteGroq = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** Las imágenes del último mensaje que sí van a Groq (hasta 3). */
function imagenesGroq(imagenes: ImagenActual[]): ImagenActual[] {
  return imagenes.slice(0, MAX_IMAGENES_GROQ);
}

/**
 * Los archivos de la conversación que Groq no ve: los PDF, las imágenes de
 * mensajes anteriores (solo le llegan las del último) y las que pasan de 3.
 */
function ciegosGroq(mensajes: Mensaje[], imagenes: ImagenActual[]): Set<Adjunto> {
  const ultimo = mensajes.length - 1;
  const vistas = new Set(imagenesGroq(imagenes).map((i) => i.nombre));
  const ciegos = new Set<Adjunto>();
  mensajes.forEach((m, i) => {
    for (const a of m.adjuntos ?? []) {
      if (a.tipo === "archivo" && !(i === ultimo && vistas.has(a.nombre))) ciegos.add(a);
    }
  });
  return ciegos;
}

/**
 * La conversación en el formato de Groq (el de OpenAI). Groq no abre PDF ni
 * las imágenes ya subidas a Gemini: ve las imágenes del último mensaje (vienen
 * en base64) y el texto de Word, Excel y demás.
 */
function mensajesGroq(mensajes: Mensaje[], imagenes: ImagenActual[], instruccion: string, extra?: string) {
  const salida: { role: string; content: string | ParteGroq[] }[] = [{ role: "system", content: instruccion }];
  const ultimo = mensajes.length - 1;
  const vistas = imagenesGroq(imagenes);
  const ciegos = ciegosGroq(mensajes, imagenes);

  mensajes.forEach((m, i) => {
    if (m.rol === "asistente") {
      salida.push({ role: "assistant", content: m.texto || "…" });
      return;
    }
    const textos: string[] = [];
    const noVistos: string[] = [];
    for (const a of m.adjuntos ?? []) {
      if (a.tipo === "texto") textos.push(textoAdjunto(a));
      else if (ciegos.has(a)) noVistos.push(a.nombre);
    }
    if (noVistos.length > 0) {
      textos.push(
        `(El usuario adjuntó ${noVistos.map((n) => `«${n}»`).join(", ")}, que tú no puedes abrir; otro asistente sí los ve. No inventes su contenido: responde lo que puedas con el resto y di qué habría que revisar en ellos.)`
      );
    }
    textos.push(m.texto || "(Sin texto: mira los archivos.)");
    if (i === ultimo && extra) textos.push(extra);

    if (i === ultimo && vistas.length > 0) {
      salida.push({
        role: "user",
        content: [
          { type: "text", text: textos.join("\n\n") },
          ...vistas.map((img) => ({
            type: "image_url" as const,
            image_url: { url: `data:${img.mime};base64,${img.datos}` },
          })),
        ],
      });
    } else {
      salida.push({ role: "user", content: textos.join("\n\n") });
    }
  });
  return salida;
}

function modeloGroq(conImagenes: boolean) {
  return conImagenes
    ? process.env.GROQ_MODELO_VISION || MODELO_GROQ_VISION
    : process.env.GROQ_MODELO || MODELO_GROQ;
}

function cuerpoGroq(mensajes: Mensaje[], imagenes: ImagenActual[], instruccion: string, enVivo: boolean, extra?: string) {
  const modelo = modeloGroq(imagenesGroq(imagenes).length > 0);
  const tope = Number(process.env.GROQ_MAX_TOKENS);
  const cuerpo: Record<string, unknown> = {
    model: modelo,
    messages: mensajesGroq(mensajes, imagenes, instruccion, extra),
    stream: enVivo,
    // El plan gratis de Groq cuenta tokens por minuto: un tope moderado deja
    // espacio para la pregunta y los documentos.
    max_completion_tokens: Number.isFinite(tope) && tope >= 256 ? Math.min(tope, 32_768) : 4096,
    temperature: 0.5,
  };
  if (/^openai\/gpt-oss/.test(modelo)) {
    // Razona antes de responder; el razonamiento no se pide de vuelta.
    // GROQ_ESFUERZO=medium o high: mejor en problemas difíciles, más lento.
    const esfuerzo = (process.env.GROQ_ESFUERZO ?? "").toLowerCase();
    cuerpo.include_reasoning = false;
    cuerpo.reasoning_effort = ["low", "medium", "high"].includes(esfuerzo) ? esfuerzo : "low";
  } else if (/^qwen\//.test(modelo)) {
    cuerpo.reasoning_format = "hidden";
  }
  return { modelo, cuerpo: JSON.stringify(cuerpo) };
}

/** Explica en palabras un error de Groq. */
async function errorGroq(respuesta: Response, modelo: string): Promise<string> {
  const json = await respuesta.json().catch(() => null);
  const detalle: string = json?.error?.message ?? `HTTP ${respuesta.status}`;
  const codigo: string = json?.error?.code ?? "";
  console.error("[asistente groq]", respuesta.status, codigo, detalle);

  if (respuesta.status === 401 || respuesta.status === 403) {
    return "Groq rechazó la llave (GROQ_API_KEY). Revisa que esté bien copiada y activa en console.groq.com.";
  }
  if (respuesta.status === 404 || codigo === "model_not_found" || codigo === "model_decommissioned") {
    return `Groq ya no tiene el modelo «${modelo}». Cambia GROQ_MODELO (o GROQ_MODELO_VISION) por uno de console.groq.com/docs/models.`;
  }
  if (respuesta.status === 413) {
    return "El mensaje es muy largo para el plan de Groq (tokens por minuto). Adjunta menos texto o empieza una conversación nueva.";
  }
  if (respuesta.status === 429) {
    const espera = Number(respuesta.headers.get("retry-after"));
    return Number.isFinite(espera) && espera > 0
      ? `Groq llegó a su límite de uso. Vuelve a intentar en ${Math.ceil(espera)} s.`
      : "Groq llegó a su límite de uso por ahora. Espera un momento y vuelve a intentar.";
  }
  if (respuesta.status === 400 && /image/i.test(detalle)) return "Groq no pudo leer la imagen.";
  if (respuesta.status >= 498) return "Groq está fallando en este momento. Intenta de nuevo en un rato.";
  return `Groq respondió con un error: ${detalle}`;
}

function pedirGroq(cuerpo: string, signal: AbortSignal) {
  return fetch(`${URL_GROQ}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY ?? ""}`,
    },
    body: cuerpo,
    signal,
    cache: "no-store",
  });
}

/** Quita el razonamiento <think>…</think> si un modelo lo deja en el texto. */
function sinPensamiento(texto: string): string {
  return texto.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "");
}

async function groq(
  mensajes: Mensaje[],
  imagenes: ImagenActual[],
  instruccion: string,
  signal: AbortSignal
): Promise<Resultado> {
  const { modelo, cuerpo } = cuerpoGroq(mensajes, imagenes, instruccion, false);
  let respuesta: Response;
  try {
    respuesta = await pedirGroq(cuerpo, signal);
  } catch (e) {
    console.error("[asistente groq] red", e);
    return { ok: false, error: signal.aborted ? "Se canceló." : "No se pudo contactar a Groq." };
  }
  if (!respuesta.ok) return { ok: false, error: await errorGroq(respuesta, modelo) };
  const json = await respuesta.json().catch(() => null);
  const texto = sinPensamiento(String(json?.choices?.[0]?.message?.content ?? "")).trim();
  return texto ? { ok: true, texto } : { ok: false, error: "Groq no devolvió texto." };
}

async function groqEnVivo(
  mensajes: Mensaje[],
  imagenes: ImagenActual[],
  instruccion: string,
  extra: string | undefined,
  alEscribir: (texto: string) => void,
  signal: AbortSignal
): Promise<Resultado> {
  const { modelo, cuerpo } = cuerpoGroq(mensajes, imagenes, instruccion, true, extra);
  let respuesta: Response;
  try {
    respuesta = await pedirGroq(cuerpo, signal);
  } catch (e) {
    console.error("[asistente groq] red", e);
    return { ok: false, error: signal.aborted ? "Se canceló." : "No se pudo contactar a Groq." };
  }
  if (!respuesta.ok || !respuesta.body) return { ok: false, error: await errorGroq(respuesta, modelo) };

  let todo = "";
  // Si el modelo empieza pensando en voz alta (<think>…</think>), eso no se muestra.
  let retenido = "";
  let pensando: boolean | null = null;
  const soltar = (texto: string) => {
    // Sin los saltos de línea que quedan entre el razonamiento y la respuesta.
    const limpio = todo ? texto : texto.trimStart();
    if (!limpio) return;
    todo += limpio;
    alEscribir(limpio);
  };
  try {
    for await (const datos of eventosSSE(respuesta.body)) {
      if (datos === "[DONE]") break;
      const json = JSON.parse(datos);
      if (json?.error) throw new Error(json.error.message ?? "error en el flujo");
      const texto: string = json?.choices?.[0]?.delta?.content ?? "";
      if (!texto) continue;
      if (pensando === false) {
        soltar(texto);
        continue;
      }
      retenido += texto;
      if (pensando === null) {
        const inicio = retenido.trimStart();
        if (inicio.length < 7 && "<think>".startsWith(inicio)) continue;
        pensando = inicio.startsWith("<think>");
      }
      if (pensando) {
        const fin = retenido.indexOf("</think>");
        if (fin === -1) continue;
        retenido = retenido.slice(fin + 8);
        pensando = false;
      } else {
        pensando = false;
      }
      if (retenido) soltar(retenido);
      retenido = "";
    }
    if (pensando === null && retenido) soltar(retenido);
  } catch (e) {
    if (signal.aborted) return { ok: false, error: "Se canceló." };
    console.error("[asistente groq] corte", e);
    if (!todo) return { ok: false, error: "Groq cortó la respuesta. Intenta de nuevo." };
  }
  return todo.trim() ? { ok: true, texto: todo } : { ok: false, error: "Groq no devolvió texto." };
}

// ------------------------------------------------------------------ SSE

/** Los «data:» de un flujo de eventos (server-sent events). */
async function* eventosSSE(cuerpo: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  let pendiente = "";
  while (true) {
    const { done, value } = await lector.read();
    if (done) break;
    pendiente += decodificador.decode(value, { stream: true });
    let corte: number;
    while ((corte = pendiente.indexOf("\n")) !== -1) {
      const linea = pendiente.slice(0, corte).replace(/\r$/, "");
      pendiente = pendiente.slice(corte + 1);
      if (linea.startsWith("data:")) {
        const datos = linea.slice(5).trim();
        if (datos) yield datos;
      }
    }
  }
  const resto = pendiente.trim();
  if (resto.startsWith("data:") && resto.slice(5).trim()) yield resto.slice(5).trim();
}

// ------------------------------------------------------------------ conversación

export function hayGemini() {
  return Boolean(process.env.GEMINI_API_KEY);
}
export function hayGroq() {
  return Boolean(process.env.GROQ_API_KEY);
}

/**
 * Responde el último mensaje de la conversación según el modo, y va contando
 * lo que pasa con `emitir` para que la pantalla lo muestre en vivo.
 */
export async function conversar(
  mensajes: Mensaje[],
  imagenes: ImagenActual[],
  modoPedido: Modo,
  emitir: (e: Evento) => void,
  signal: AbortSignal
): Promise<void> {
  const conGroq = hayGroq();
  const conGemini = hayGemini();

  if (!conGroq && !conGemini) {
    emitir({
      t: "error",
      mensaje: "Faltan las llaves de las IA. Agrega GROQ_API_KEY y GEMINI_API_KEY en el entorno del proyecto y vuelve a desplegar.",
    });
    return;
  }

  const hayPdf = mensajes.some((m) => (m.adjuntos ?? []).some((a) => a.tipo === "archivo" && a.mime === "application/pdf"));
  const groqVeTodo = ciegosGroq(mensajes, imagenes).size === 0;
  const PDF_SIN_GROQ = "Groq no abre PDF: la respuesta no tiene en cuenta el PDF.";

  let modo = modoPedido;
  let aviso: string | undefined;

  if (modo === "combinado" && !conGemini) {
    modo = "groq";
    aviso = "Respondió solo Groq: falta GEMINI_API_KEY.";
  } else if (modo === "combinado" && !conGroq) {
    modo = "gemini";
    aviso = "Respondió solo Gemini: falta GROQ_API_KEY.";
  } else if (modo === "groq" && !conGroq) {
    modo = "gemini";
    aviso = "Respondió Gemini: falta GROQ_API_KEY.";
  } else if (modo === "gemini" && !conGemini) {
    modo = "groq";
    aviso = "Respondió Groq: falta GEMINI_API_KEY.";
  } else if (modo === "groq" && hayPdf && conGemini) {
    // Groq no abre PDF: ese lo lee Gemini.
    modo = "gemini";
    aviso = "Groq no abre PDF: respondió Gemini.";
  }
  if (modo === "groq" && hayPdf) aviso = [aviso, PDF_SIN_GROQ].filter(Boolean).join(" ");

  const base = instruccionBase();
  const escribir = (texto: string) => emitir({ t: "texto", texto });
  const hay = (ia: IA) => (ia === "groq" ? conGroq : conGemini);
  const enVivo = (ia: IA, instruccion: string, extra?: string) =>
    ia === "groq"
      ? groqEnVivo(mensajes, imagenes, instruccion, extra, escribir, signal)
      : geminiEnVivo(mensajes, instruccion, extra, escribir, signal);

  // ---------------------------------------------------------- una sola IA
  if (modo === "groq" || modo === "gemini") {
    const ia: IA = modo;
    emitir({ t: "estado", texto: `${NOMBRE[ia]} está respondiendo…` });
    const r = await enVivo(ia, base);
    if (r.ok) return emitir({ t: "fin", fuentes: [ia], aviso });
    if (signal.aborted) return;

    // La elegida falló sin escribir nada: responde la otra.
    const otra: IA = ia === "groq" ? "gemini" : "groq";
    if (!hay(otra)) return emitir({ t: "error", mensaje: r.error });
    emitir({ t: "estado", texto: `${NOMBRE[ia]} no pudo responder. Ahora responde ${NOMBRE[otra]}…` });
    const r2 = await enVivo(otra, base);
    if (!r2.ok) return signal.aborted ? undefined : emitir({ t: "error", mensaje: `${r.error} ${r2.error}` });
    const ciego = otra === "groq" && hayPdf ? ` ${PDF_SIN_GROQ}` : "";
    return emitir({ t: "fin", fuentes: [otra], aviso: `Respondió ${NOMBRE[otra]}: ${r.error}${ciego}` });
  }

  // ---------------------------------------------------------- las dos juntas
  emitir({ t: "estado", texto: "Groq y Gemini están respondiendo…" });
  const [deGroq, deGemini] = await Promise.all([
    groq(mensajes, imagenes, base, signal).then((r) => {
      emitir({ t: "borrador", ia: "groq", ...(r.ok ? { texto: r.texto } : { error: r.error }) });
      return r;
    }),
    gemini(mensajes, base, signal).then((r) => {
      emitir({ t: "borrador", ia: "gemini", ...(r.ok ? { texto: r.texto } : { error: r.error }) });
      return r;
    }),
  ]);

  if (signal.aborted) return;

  if (!deGroq.ok && !deGemini.ok) {
    return emitir({ t: "error", mensaje: `${deGroq.error} ${deGemini.error}` });
  }

  // Si una falló, la respuesta es la de la otra, tal cual.
  if (!deGroq.ok || !deGemini.ok) {
    const fuente: IA = deGroq.ok ? "groq" : "gemini";
    const buena = (deGroq.ok ? deGroq : deGemini) as { ok: true; texto: string };
    const mala = (deGroq.ok ? deGemini : deGroq) as { ok: false; error: string };
    escribir(buena.texto);
    const ciego = fuente === "groq" && hayPdf ? ` ${PDF_SIN_GROQ}` : "";
    return emitir({ t: "fin", fuentes: [fuente], aviso: `Respondió solo ${NOMBRE[fuente]}: ${mala.error}${ciego}` });
  }

  // Groq escribe la respuesta final. Si hay algo que Groq no ve (un PDF, una
  // imagen de antes), la escribe Gemini, que sí lo ve.
  const editor: IA = groqVeTodo ? "groq" : "gemini";
  emitir({ t: "estado", texto: "Combinando las dos respuestas…" });
  const borradores = `--- Borrador A ---\n${deGroq.texto}\n\n--- Borrador B ---\n${deGemini.texto}\n\n--- Fin de los borradores ---\nEscribe ahora la respuesta final al último mensaje del usuario.`;
  const final = await enVivo(editor, base + INSTRUCCION_SINTESIS, borradores);

  if (!final.ok) {
    if (signal.aborted) return;
    // Sin síntesis, al menos la respuesta de la que iba a combinar.
    const propia = editor === "groq" ? deGroq : deGemini;
    escribir(propia.texto);
    return emitir({
      t: "fin",
      fuentes: [editor],
      aviso: `No se pudieron combinar las respuestas (${final.error}). Esta es la de ${NOMBRE[editor]}.`,
    });
  }
  emitir({ t: "fin", fuentes: ["groq", "gemini"], aviso });
}

// ------------------------------------------------------------------ archivos

/** Tipos que se suben a Gemini. Word, Excel y demás se mandan como texto. */
export const MIMES_ARCHIVO = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
];

export type ArchivoGemini = { uri: string; mime: string; nombre: string };

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sube un archivo a la Files API de Gemini (subida reanudable en un solo
 * envío) y espera a que quede listo. Gemini lo borra solo a las 48 horas.
 */
export async function subirAGemini(
  datos: Uint8Array,
  mime: string,
  nombre: string
): Promise<{ ok: true; archivo: ArchivoGemini } | { ok: false; error: string }> {
  if (!hayGemini()) {
    return { ok: false, error: "Para leer imágenes y PDF hace falta GEMINI_API_KEY en el entorno del proyecto." };
  }
  const modelo = modeloGemini();

  try {
    const inicio = await pedirGemini("/upload/v1beta/files", {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(datos.byteLength),
        "X-Goog-Upload-Header-Content-Type": mime,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: nombre.slice(0, 120) } }),
    });
    if (!inicio.ok) return { ok: false, error: await errorGemini(inicio, modelo) };

    const destino = inicio.headers.get("x-goog-upload-url");
    if (!destino) return { ok: false, error: "Gemini no devolvió a dónde subir el archivo." };

    const subida = await pedirGemini(destino, {
      method: "POST",
      headers: {
        // El largo lo pone fetch solo, a partir de los datos.
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: datos,
    });
    if (!subida.ok) return { ok: false, error: await errorGemini(subida, modelo) };

    const archivo = (await subida.json().catch(() => null))?.file as
      | { name?: string; uri?: string; mimeType?: string; state?: string }
      | undefined;
    if (!archivo?.uri || !archivo.name) return { ok: false, error: "Gemini no confirmó el archivo." };

    // Los PDF pasan un rato «procesándose» antes de poder usarse.
    const nombreGemini = archivo.name;
    let estadoArchivo = archivo.state;
    for (let i = 0; i < 40 && estadoArchivo === "PROCESSING"; i++) {
      await esperar(1500);
      const estado = await pedirGemini(`/v1beta/${nombreGemini}`, { method: "GET" });
      if (!estado.ok) break;
      estadoArchivo = ((await estado.json().catch(() => null)) as { state?: string } | null)?.state;
    }
    if (estadoArchivo === "FAILED") return { ok: false, error: "Gemini no pudo leer ese archivo." };
    if (estadoArchivo === "PROCESSING") {
      return { ok: false, error: "Gemini se está demorando en leer el archivo. Intenta de nuevo." };
    }

    return { ok: true, archivo: { uri: archivo.uri, mime: archivo.mimeType || mime, nombre } };
  } catch (e) {
    console.error("[asistente subir]", e);
    return { ok: false, error: "No se pudo subir el archivo a Gemini." };
  }
}
