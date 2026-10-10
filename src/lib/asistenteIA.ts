/**
 * Asistente IA del panel: Gemini y DeepSeek juntos. SOLO SERVIDOR.
 *
 * Las llaves viven en el entorno (GEMINI_API_KEY y DEEPSEEK_API_KEY) y nunca
 * llegan al navegador: si estuvieran en el cliente, cualquiera las sacaría del
 * código de la página y las gastaría por su cuenta.
 *
 * Modo combinado (el de siempre):
 *   1. Gemini y DeepSeek escriben cada uno un borrador, al mismo tiempo.
 *   2. Gemini, que también ve los archivos, los compara y escribe la
 *      respuesta final: toma lo mejor de cada uno y corrige lo que no cuadre.
 * Si una de las dos falla, la respuesta sale de la otra y se avisa.
 */

const URL_GEMINI = "https://generativelanguage.googleapis.com";
const URL_DEEPSEEK = "https://api.deepseek.com";

/** Prefijo de los archivos subidos a Gemini: es lo único que se acepta como archivo. */
export const PREFIJO_ARCHIVO_GEMINI = `${URL_GEMINI}/v1beta/files/`;

/**
 * Modelos por defecto (octubre de 2026). Se cambian sin tocar código con
 * GEMINI_MODELO_CHAT y DEEPSEEK_MODELO.
 */
export const MODELO_GEMINI = "gemini-3.8-flash";
export const MODELO_DEEPSEEK = "deepseek-flash";

export type Modo = "combinado" | "gemini" | "deepseek";
export type IA = "gemini" | "deepseek";

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

/** Imágenes del último mensaje en base64, para DeepSeek (Gemini las ve por su uri). */
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
- No menciones los borradores, ni que hubo dos asistentes, ni a Gemini o DeepSeek.
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

// ------------------------------------------------------------------ DeepSeek

type ParteDeepSeek = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/**
 * La conversación en el formato de DeepSeek (el de OpenAI). DeepSeek no abre
 * PDF ni las imágenes ya subidas a Gemini: ve las imágenes del último mensaje
 * (vienen en base64) y el texto de Word, Excel y demás.
 */
function mensajesDeepSeek(mensajes: Mensaje[], imagenes: ImagenActual[], instruccion: string) {
  const salida: { role: string; content: string | ParteDeepSeek[] }[] = [
    { role: "system", content: instruccion },
  ];
  const ultimo = mensajes.length - 1;
  const conImagen = new Set(imagenes.map((i) => i.nombre));

  mensajes.forEach((m, i) => {
    if (m.rol === "asistente") {
      salida.push({ role: "assistant", content: m.texto || "…" });
      return;
    }
    const textos: string[] = [];
    const ciegos: string[] = [];
    for (const a of m.adjuntos ?? []) {
      if (a.tipo === "texto") textos.push(textoAdjunto(a));
      else if (!(i === ultimo && conImagen.has(a.nombre))) ciegos.push(a.nombre);
    }
    if (ciegos.length > 0) {
      textos.push(
        `(El usuario adjuntó ${ciegos.map((n) => `«${n}»`).join(", ")}, que tú no puedes abrir; otro asistente sí los ve. No inventes su contenido: responde lo que puedas con el resto y di qué habría que revisar en ellos.)`
      );
    }
    textos.push(m.texto || "(Sin texto: mira los archivos.)");

    if (i === ultimo && imagenes.length > 0) {
      salida.push({
        role: "user",
        content: [
          { type: "text", text: textos.join("\n\n") },
          ...imagenes.map((img) => ({
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

function cuerpoDeepSeek(mensajes: Mensaje[], imagenes: ImagenActual[], instruccion: string, enVivo: boolean) {
  const pensar = (process.env.DEEPSEEK_PENSAR ?? "").toLowerCase();
  return JSON.stringify({
    model: process.env.DEEPSEEK_MODELO || MODELO_DEEPSEEK,
    messages: mensajesDeepSeek(mensajes, imagenes, instruccion),
    stream: enVivo,
    // Sin «pensar» responde bastante más rápido; con DEEPSEEK_PENSAR=si razona antes.
    thinking: { type: pensar === "si" || pensar === "sí" ? "enabled" : "disabled" },
    max_tokens: 8192,
    temperature: 0.5,
  });
}

async function errorDeepSeek(respuesta: Response): Promise<string> {
  const json = await respuesta.json().catch(() => null);
  const detalle: string = json?.error?.message ?? `HTTP ${respuesta.status}`;
  console.error("[asistente deepseek]", respuesta.status, detalle);
  if (respuesta.status === 401) return "DeepSeek rechazó la llave (DEEPSEEK_API_KEY). Revisa que esté bien copiada.";
  if (respuesta.status === 402) return "La cuenta de DeepSeek se quedó sin saldo. Recárgala en platform.deepseek.com.";
  if (respuesta.status === 429) return "DeepSeek está recibiendo demasiadas consultas. Espera un momento.";
  if (respuesta.status === 400 && /image|vision/i.test(detalle)) {
    return "El modelo de DeepSeek configurado no acepta imágenes. Usa deepseek-flash en DEEPSEEK_MODELO.";
  }
  if (respuesta.status >= 500) return "DeepSeek está fallando en este momento. Intenta de nuevo en un rato.";
  return `DeepSeek respondió con un error: ${detalle}`;
}

function pedirDeepSeek(cuerpo: string, signal: AbortSignal) {
  return fetch(`${URL_DEEPSEEK}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY ?? ""}`,
    },
    body: cuerpo,
    signal,
    cache: "no-store",
  });
}

async function deepseek(
  mensajes: Mensaje[],
  imagenes: ImagenActual[],
  instruccion: string,
  signal: AbortSignal
): Promise<Resultado> {
  let respuesta: Response;
  try {
    respuesta = await pedirDeepSeek(cuerpoDeepSeek(mensajes, imagenes, instruccion, false), signal);
  } catch (e) {
    console.error("[asistente deepseek] red", e);
    return { ok: false, error: signal.aborted ? "Se canceló." : "No se pudo contactar a DeepSeek." };
  }
  if (!respuesta.ok) return { ok: false, error: await errorDeepSeek(respuesta) };
  const json = await respuesta.json().catch(() => null);
  const texto = String(json?.choices?.[0]?.message?.content ?? "").trim();
  return texto ? { ok: true, texto } : { ok: false, error: "DeepSeek no devolvió texto." };
}

async function deepseekEnVivo(
  mensajes: Mensaje[],
  imagenes: ImagenActual[],
  instruccion: string,
  alEscribir: (texto: string) => void,
  signal: AbortSignal
): Promise<Resultado> {
  let respuesta: Response;
  try {
    respuesta = await pedirDeepSeek(cuerpoDeepSeek(mensajes, imagenes, instruccion, true), signal);
  } catch (e) {
    console.error("[asistente deepseek] red", e);
    return { ok: false, error: signal.aborted ? "Se canceló." : "No se pudo contactar a DeepSeek." };
  }
  if (!respuesta.ok || !respuesta.body) return { ok: false, error: await errorDeepSeek(respuesta) };

  let todo = "";
  try {
    for await (const datos of eventosSSE(respuesta.body)) {
      if (datos === "[DONE]") break;
      const texto: string = JSON.parse(datos)?.choices?.[0]?.delta?.content ?? "";
      if (texto) {
        todo += texto;
        alEscribir(texto);
      }
    }
  } catch (e) {
    if (signal.aborted) return { ok: false, error: "Se canceló." };
    console.error("[asistente deepseek] corte", e);
    if (!todo) return { ok: false, error: "DeepSeek cortó la respuesta. Intenta de nuevo." };
  }
  return todo.trim() ? { ok: true, texto: todo } : { ok: false, error: "DeepSeek no devolvió texto." };
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
export function hayDeepSeek() {
  return Boolean(process.env.DEEPSEEK_API_KEY);
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
  const conGemini = hayGemini();
  const conDeepSeek = hayDeepSeek();

  if (!conGemini && !conDeepSeek) {
    emitir({
      t: "error",
      mensaje: "Faltan las llaves de las IA. Agrega GEMINI_API_KEY y DEEPSEEK_API_KEY en el entorno del proyecto y vuelve a desplegar.",
    });
    return;
  }

  const tieneArchivos = mensajes.some((m) => (m.adjuntos ?? []).some((a) => a.tipo === "archivo"));
  let modo = modoPedido;
  let aviso: string | undefined;

  if (modo === "combinado" && !conDeepSeek) {
    modo = "gemini";
    aviso = "Respondió solo Gemini: falta DEEPSEEK_API_KEY.";
  } else if (modo === "combinado" && !conGemini) {
    modo = "deepseek";
    aviso = "Respondió solo DeepSeek: falta GEMINI_API_KEY.";
  } else if (modo === "gemini" && !conGemini) {
    emitir({ t: "error", mensaje: "Falta GEMINI_API_KEY en el entorno del proyecto." });
    return;
  } else if (modo === "deepseek" && !conDeepSeek) {
    emitir({ t: "error", mensaje: "Falta DEEPSEEK_API_KEY en el entorno del proyecto." });
    return;
  }

  const base = instruccionBase();
  const escribir = (texto: string) => emitir({ t: "texto", texto });

  // ---------------------------------------------------------- una sola IA
  if (modo === "gemini") {
    emitir({ t: "estado", texto: "Gemini está respondiendo…" });
    const r = await geminiEnVivo(mensajes, base, undefined, escribir, signal);
    if (!r.ok) return emitir({ t: "error", mensaje: r.error });
    return emitir({ t: "fin", fuentes: ["gemini"], aviso });
  }

  if (modo === "deepseek") {
    emitir({ t: "estado", texto: "DeepSeek está respondiendo…" });
    const r = await deepseekEnVivo(mensajes, imagenes, base, escribir, signal);
    if (!r.ok) return emitir({ t: "error", mensaje: r.error });
    const ciego =
      tieneArchivos && mensajes.some((m) => (m.adjuntos ?? []).some((a) => a.tipo === "archivo" && a.mime === "application/pdf"))
        ? "DeepSeek no abre PDF: para preguntas sobre un PDF usa el modo combinado o solo Gemini."
        : undefined;
    return emitir({ t: "fin", fuentes: ["deepseek"], aviso: aviso ?? ciego });
  }

  // ---------------------------------------------------------- las dos juntas
  emitir({ t: "estado", texto: "Gemini y DeepSeek están respondiendo…" });
  const [deGemini, deDeepSeek] = await Promise.all([
    gemini(mensajes, base, signal).then((r) => {
      emitir({ t: "borrador", ia: "gemini", ...(r.ok ? { texto: r.texto } : { error: r.error }) });
      return r;
    }),
    deepseek(mensajes, imagenes, base, signal).then((r) => {
      emitir({ t: "borrador", ia: "deepseek", ...(r.ok ? { texto: r.texto } : { error: r.error }) });
      return r;
    }),
  ]);

  if (signal.aborted) return;

  if (!deGemini.ok && !deDeepSeek.ok) {
    return emitir({ t: "error", mensaje: `${deGemini.error} ${deDeepSeek.error}` });
  }

  // Si una falló, la respuesta es la de la otra, tal cual.
  if (!deGemini.ok || !deDeepSeek.ok) {
    const buena = deGemini.ok ? deGemini : (deDeepSeek as { ok: true; texto: string });
    const fuente: IA = deGemini.ok ? "gemini" : "deepseek";
    const mala = deGemini.ok ? deDeepSeek : deGemini;
    escribir(buena.texto);
    return emitir({
      t: "fin",
      fuentes: [fuente],
      aviso: `Respondió solo ${fuente === "gemini" ? "Gemini" : "DeepSeek"}: ${!mala.ok ? mala.error : ""}`.trim(),
    });
  }

  emitir({ t: "estado", texto: "Combinando las dos respuestas…" });
  const borradores = `--- Borrador A ---\n${deGemini.texto}\n\n--- Borrador B ---\n${deDeepSeek.texto}\n\n--- Fin de los borradores ---\nEscribe ahora la respuesta final al último mensaje del usuario.`;
  const final = await geminiEnVivo(mensajes, base + INSTRUCCION_SINTESIS, borradores, escribir, signal);

  if (!final.ok) {
    if (signal.aborted) return;
    // Sin síntesis, al menos la respuesta de Gemini.
    escribir(deGemini.texto);
    return emitir({ t: "fin", fuentes: ["gemini"], aviso: `No se pudieron combinar las respuestas (${final.error}). Esta es la de Gemini.` });
  }
  emitir({ t: "fin", fuentes: ["gemini", "deepseek"], aviso });
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
