/**
 * Asistente IA del panel: Groq (principal), Gemini (secundaria) y GPT-4o por
 * OpenRouter (respaldo). SOLO SERVIDOR.
 *
 * Las llaves viven en el entorno (GROQ_API_KEY, GEMINI_API_KEY y
 * OPENROUTER_API_KEY) y nunca
 * llegan al navegador: si estuvieran en el cliente, cualquiera las sacaría del
 * código de la página y las gastaría por su cuenta.
 *
 * Modo combinado (el de siempre):
 *   1. Groq y Gemini escriben cada uno un borrador, al mismo tiempo.
 *   2. Groq los compara y escribe la respuesta final: toma lo mejor de cada
 *      uno y corrige lo que no cuadre. Si en la conversación hay algo que Groq
 *      no ve (un PDF, una imagen de un mensaje anterior), la escribe Gemini.
 * Si una de las dos falla, la respuesta sale de la otra y se avisa; si fallan
 * las dos, responde GPT-4o. En «Solo Groq», «Solo Gemini» y «Solo GPT-4o», si
 * la elegida falla, responden las demás en ese orden.
 */

import {
  ahoraLegible,
  consultasPara,
  diaBogota,
  ejecutarConsulta,
  sumarDias,
  type ConsultaPanel,
  type PermisosPanel,
  type ResultadoConsulta,
} from "./datosPanel";
import { conRotacion, nombreModelo, type OpcionesRotacion, type Rotacion } from "./modelosGemini";

const URL_GEMINI = "https://generativelanguage.googleapis.com";
const URL_GROQ = "https://api.groq.com/openai/v1";
const URL_OPENROUTER = "https://openrouter.ai/api/v1";

/** Prefijo de los archivos subidos a Gemini: es lo único que se acepta como archivo. */
export const PREFIJO_ARCHIVO_GEMINI = `${URL_GEMINI}/v1beta/files/`;

/**
 * Modelos por defecto (octubre de 2026). Se cambian sin tocar código con
 * GEMINI_MODELO_CHAT, GROQ_MODELO, GROQ_MODELO_VISION y OPENROUTER_MODELO.
 * - openai/gpt-oss-120b: el modelo de producción más capaz de Groq (solo texto).
 * - qwen/qwen3.8-27b: el único de Groq que ve imágenes (está en vista previa).
 */
export const MODELO_GEMINI = "gemini-3.8-flash";
export const MODELO_GROQ = "openai/gpt-oss-120b";
export const MODELO_GROQ_VISION = "qwen/qwen3.8-27b";
/** El de OpenRouter se cambia con OPENROUTER_MODELO (en la pantalla sigue diciendo GPT-4o). */
export const MODELO_OPENROUTER = "openai/gpt-4o";
/** Groq acepta hasta 3 imágenes por mensaje; GPT-4o, las del mensaje (hasta 6). */
const MAX_IMAGENES_GROQ = 3;
const MAX_IMAGENES_OPENROUTER = 6;

export type Modo = "combinado" | "groq" | "gemini" | "openrouter";
export type IA = "groq" | "gemini" | "openrouter";

const NOMBRE: Record<IA, string> = { groq: "Groq", gemini: "Gemini", openrouter: "GPT-4o" };

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

/** modelo: con Gemini, cuál de sus modelos respondió (ver lib/modelosGemini.ts). */
export type Resultado = { ok: true; texto: string; modelo?: string } | { ok: false; error: string };

/** Lo que va saliendo hacia el navegador, una línea de JSON por evento. */
export type Evento =
  | { t: "estado"; texto: string }
  | { t: "borrador"; ia: IA; texto?: string; error?: string }
  | { t: "texto"; texto: string }
  /** modelos: con qué modelo respondió cada IA, si se sabe (hoy, el de Gemini). */
  | { t: "fin"; fuentes: IA[]; aviso?: string; modelos?: Partial<Record<IA, string>> }
  /** Qué se consultó del panel para responder. */
  | { t: "datos"; consultas: { titulo: string; ok: boolean; error?: string }[] }
  | { t: "error"; mensaje: string };

// ------------------------------------------------------------------ instrucciones

function hoy(): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());
}

/**
 * consultables: los títulos de lo que el perfil puede consultar del panel;
 * null si esta conversación no consulta el panel.
 */
function instruccionBase(consultables: string[] | null = null): string {
  const panel =
    consultables === null
      ? ""
      : `
- Datos del panel: si el mensaje trae un bloque «Datos del panel (consultados…)», son cifras reales del sistema consultadas en ese momento. Úsalas exactas, di de qué módulo salen y cuándo se consultaron; si conviene, en una tabla corta. Nunca inventes cifras del panel.
- ${
          consultables.length
            ? `Con el perfil de este usuario se puede consultar: ${consultables.join(", ")}. Si pide cifras de otro módulo, dile que su perfil no tiene acceso a ese módulo.`
            : "El perfil de este usuario no tiene módulos del panel para consultar: si pide cifras del panel, díselo."
        }`;
  return `Eres el asistente de inteligencia artificial del equipo de Overall Colombia que maneja la cartera LiveTrade (puntos de venta, consultores de campo, rutas, auditorías y tableros de Power BI). Ayudas con cualquier tema: preguntas generales, redacción, Excel, SQL, Python, cálculos, ideas y análisis de documentos e imágenes.

Hoy es ${hoy()} (hora de Colombia).

Cómo respondes:
- En español de Colombia, salvo que te pidan otro idioma. Directo y claro, sin rodeos.
- Con Markdown cuando ayuda a leer: títulos cortos, listas, tablas, y bloques de código con su lenguaje.
- Si hay archivos adjuntos, te basas en lo que dicen: cita cifras y textos exactos; si algo no se lee o no está, lo dices.
- No inventas datos, cifras, fuentes ni enlaces. Si no sabes algo o no estás seguro, lo dices.
- No repites números de cédula, teléfonos ni datos personales completos de terceros si no hace falta para la tarea.${panel}`;
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

export async function pedirGemini(
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
async function errorGemini(respuesta: Response, modelo: string, probados: string[] = []): Promise<string> {
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
  if (respuesta.status === 429) {
    return probados.length > 1
      ? `Gemini llegó a su cupo en los ${probados.length} modelos que probó (${probados.map(nombreModelo).join(", ")}). Espera un momento y vuelve a intentar.`
      : "Se agotó por ahora la cuota de Gemini. Espera un momento y vuelve a intentar.";
  }
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

/**
 * Una petición a Gemini que, si el modelo preferido agotó su cupo, prueba con
 * los demás modelos de la cuenta (lib/modelosGemini.ts).
 */
function rotarGemini(
  accion: string,
  cuerpo: string,
  signal: AbortSignal,
  preferido = modeloGemini(),
  opciones: OpcionesRotacion = {}
): Promise<Rotacion> {
  return conRotacion(
    pedirGemini,
    preferido,
    (modelo) =>
      pedirGemini(`/v1beta/models/${modelo}:${accion}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: cuerpo,
        signal,
      }),
    opciones
  );
}

/** Respuesta completa de Gemini, de una vez. */
async function gemini(mensajes: Mensaje[], instruccion: string, signal: AbortSignal): Promise<Resultado> {
  let r: Rotacion;
  try {
    r = await rotarGemini("generateContent", cuerpoGemini(mensajes, instruccion), signal);
  } catch (e) {
    console.error("[asistente gemini] red", e);
    return { ok: false, error: signal.aborted ? "Se canceló." : "No se pudo contactar a Gemini." };
  }
  if (!r.respuesta) return { ok: false, error: r.mensaje };
  if (!r.respuesta.ok) return { ok: false, error: await errorGemini(r.respuesta, r.modelo, r.probados) };
  const json = await r.respuesta.json().catch(() => null);
  const texto = textoDeRespuestaGemini(json).trim();
  return texto ? { ok: true, texto, modelo: r.modelo } : { ok: false, error: motivoVacioGemini(json) };
}

/** Respuesta de Gemini por partes, a medida que la escribe. */
async function geminiEnVivo(
  mensajes: Mensaje[],
  instruccion: string,
  extra: string | undefined,
  alEscribir: (texto: string) => void,
  signal: AbortSignal
): Promise<Resultado> {
  let r: Rotacion;
  try {
    r = await rotarGemini("streamGenerateContent?alt=sse", cuerpoGemini(mensajes, instruccion, extra), signal);
  } catch (e) {
    console.error("[asistente gemini] red", e);
    return { ok: false, error: signal.aborted ? "Se canceló." : "No se pudo contactar a Gemini." };
  }
  if (!r.respuesta) return { ok: false, error: r.mensaje };
  const respuesta = r.respuesta;
  const modelo = r.modelo;
  if (!respuesta.ok || !respuesta.body) return { ok: false, error: await errorGemini(respuesta, modelo, r.probados) };

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
  return todo.trim() ? { ok: true, texto: todo, modelo } : { ok: false, error: motivoVacioGemini(ultimo) };
}

// ------------------------------------------------------------------ Groq y OpenRouter

/**
 * Groq y OpenRouter hablan el mismo formato (el de OpenAI): mismos mensajes,
 * mismas imágenes en base64, mismo flujo en vivo y mismas llamadas a
 * funciones. Cambian la dirección, la llave, los modelos, algunos ajustes y
 * cómo explican sus errores.
 */
type IAOpenAI = "groq" | "openrouter";

type Proveedor = {
  ia: IAOpenAI;
  url: string;
  llave: () => string;
  cabeceras: () => Record<string, string>;
  /** Cuántas imágenes del último mensaje acepta. */
  maxImagenes: number;
  modelo: (conImagenes: boolean) => string;
  /** Lo que cada uno agrega al cuerpo: tope de tokens, razonamiento… */
  ajustar: (cuerpo: Record<string, unknown>, modelo: string, uso: "respuesta" | "plan") => void;
  error: (respuesta: Response, modelo: string) => Promise<string>;
};

/** Un tope de tokens del entorno, o el de por defecto. */
function tope(variable: string, porDefecto: number): number {
  const n = Number(process.env[variable]);
  return Number.isFinite(n) && n >= 256 ? Math.min(n, 32_768) : porDefecto;
}

const GROQ: Proveedor = {
  ia: "groq",
  url: URL_GROQ,
  llave: () => process.env.GROQ_API_KEY ?? "",
  cabeceras: () => ({}),
  maxImagenes: MAX_IMAGENES_GROQ,
  modelo: (conImagenes) =>
    conImagenes ? process.env.GROQ_MODELO_VISION || MODELO_GROQ_VISION : process.env.GROQ_MODELO || MODELO_GROQ,
  ajustar(cuerpo, modelo, uso) {
    // El plan gratis de Groq cuenta tokens por minuto: un tope moderado deja
    // espacio para la pregunta y los documentos.
    cuerpo.max_completion_tokens = uso === "plan" ? 1024 : tope("GROQ_MAX_TOKENS", 4096);
    if (/^openai\/gpt-oss/.test(modelo)) {
      // Razona antes de responder; el razonamiento no se pide de vuelta.
      // GROQ_ESFUERZO=medium o high: mejor en problemas difíciles, más lento.
      const esfuerzo = (process.env.GROQ_ESFUERZO ?? "").toLowerCase();
      cuerpo.include_reasoning = false;
      cuerpo.reasoning_effort = uso === "plan" ? "low" : ["low", "medium", "high"].includes(esfuerzo) ? esfuerzo : "low";
    } else if (/^qwen\//.test(modelo)) {
      cuerpo.reasoning_format = "hidden";
    }
  },
  error: errorGroq,
};

const OPENROUTER: Proveedor = {
  ia: "openrouter",
  url: URL_OPENROUTER,
  llave: () => process.env.OPENROUTER_API_KEY ?? "",
  cabeceras: () => ({
    // Opcionales: con qué nombre sale la app en las estadísticas de OpenRouter.
    "X-Title": "Cartera LiveTrade",
    ...(process.env.OPENROUTER_SITIO ? { "HTTP-Referer": process.env.OPENROUTER_SITIO } : {}),
  }),
  maxImagenes: MAX_IMAGENES_OPENROUTER,
  modelo: () => process.env.OPENROUTER_MODELO || MODELO_OPENROUTER,
  ajustar(cuerpo, _modelo, uso) {
    // OpenRouter cobra por token: el tope evita respuestas larguísimas.
    cuerpo.max_tokens = uso === "plan" ? 1024 : tope("OPENROUTER_MAX_TOKENS", 4096);
  },
  error: errorOpenRouter,
};

const PROVEEDOR: Record<IAOpenAI, Proveedor> = { groq: GROQ, openrouter: OPENROUTER };

type ParteOpenAI = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** Las imágenes del último mensaje que sí le llegan a ese proveedor. */
function imagenesDe(p: Proveedor, imagenes: ImagenActual[]): ImagenActual[] {
  return imagenes.slice(0, p.maxImagenes);
}

/**
 * Los archivos de la conversación que ese proveedor no ve: los PDF, las
 * imágenes de mensajes anteriores (solo le llegan las del último en base64) y
 * las que pasan de su tope.
 */
function ciegosDe(p: Proveedor, mensajes: Mensaje[], imagenes: ImagenActual[]): Set<Adjunto> {
  const ultimo = mensajes.length - 1;
  const vistas = new Set(imagenesDe(p, imagenes).map((i) => i.nombre));
  const ciegos = new Set<Adjunto>();
  mensajes.forEach((m, i) => {
    for (const a of m.adjuntos ?? []) {
      if (a.tipo === "archivo" && !(i === ultimo && vistas.has(a.nombre))) ciegos.add(a);
    }
  });
  return ciegos;
}

/**
 * La conversación en el formato de OpenAI. Groq y GPT-4o no abren PDF ni las
 * imágenes ya subidas a Gemini: ven las imágenes del último mensaje (vienen en
 * base64) y el texto de Word, Excel y demás.
 */
function mensajesOpenAI(p: Proveedor, mensajes: Mensaje[], imagenes: ImagenActual[], instruccion: string, extra?: string) {
  const salida: { role: string; content: string | ParteOpenAI[] }[] = [{ role: "system", content: instruccion }];
  const ultimo = mensajes.length - 1;
  const vistas = imagenesDe(p, imagenes);
  const ciegos = ciegosDe(p, mensajes, imagenes);

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

function cuerpoOpenAI(p: Proveedor, mensajes: Mensaje[], imagenes: ImagenActual[], instruccion: string, enVivo: boolean, extra?: string) {
  const modelo = p.modelo(imagenesDe(p, imagenes).length > 0);
  const cuerpo: Record<string, unknown> = {
    model: modelo,
    messages: mensajesOpenAI(p, mensajes, imagenes, instruccion, extra),
    stream: enVivo,
    temperature: 0.5,
  };
  p.ajustar(cuerpo, modelo, "respuesta");
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

/** Explica en palabras un error de OpenRouter. */
async function errorOpenRouter(respuesta: Response, modelo: string): Promise<string> {
  const json = await respuesta.json().catch(() => null);
  const detalle: string = json?.error?.message ?? `HTTP ${respuesta.status}`;
  console.error("[asistente openrouter]", respuesta.status, detalle);

  if (respuesta.status === 401) {
    return "OpenRouter rechazó la llave (OPENROUTER_API_KEY). Revisa que esté bien copiada y activa en openrouter.ai/keys.";
  }
  if (respuesta.status === 402) return "La cuenta de OpenRouter se quedó sin saldo. Recárgala en openrouter.ai/credits.";
  if (respuesta.status === 403) return "OpenRouter no dejó pasar el mensaje por sus filtros de contenido.";
  if (respuesta.status === 404) {
    return `OpenRouter no tiene el modelo «${modelo}». Cambia OPENROUTER_MODELO por uno de openrouter.ai/models.`;
  }
  if (respuesta.status === 408) return "GPT-4o se demoró demasiado en responder. Intenta de nuevo.";
  if (respuesta.status === 413) return "El mensaje es demasiado grande para GPT-4o. Adjunta menos texto.";
  if (respuesta.status === 429) return "OpenRouter está recibiendo demasiadas consultas. Espera un momento.";
  if (respuesta.status === 400 && /image/i.test(detalle)) return "GPT-4o no pudo leer la imagen.";
  if (respuesta.status >= 500) return "GPT-4o está fallando en este momento. Intenta de nuevo en un rato.";
  return `OpenRouter respondió con un error: ${detalle}`;
}

function pedirOpenAI(p: Proveedor, cuerpo: string, signal: AbortSignal) {
  return fetch(`${p.url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${p.llave()}`,
      ...p.cabeceras(),
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

/** Respuesta completa, de una vez. */
async function respuestaOpenAI(
  p: Proveedor,
  mensajes: Mensaje[],
  imagenes: ImagenActual[],
  instruccion: string,
  signal: AbortSignal
): Promise<Resultado> {
  const { modelo, cuerpo } = cuerpoOpenAI(p, mensajes, imagenes, instruccion, false);
  let respuesta: Response;
  try {
    respuesta = await pedirOpenAI(p, cuerpo, signal);
  } catch (e) {
    console.error(`[asistente ${p.ia}] red`, e);
    return { ok: false, error: signal.aborted ? "Se canceló." : `No se pudo contactar a ${NOMBRE[p.ia]}.` };
  }
  if (!respuesta.ok) return { ok: false, error: await p.error(respuesta, modelo) };
  const json = await respuesta.json().catch(() => null);
  const texto = sinPensamiento(String(json?.choices?.[0]?.message?.content ?? "")).trim();
  return texto ? { ok: true, texto } : { ok: false, error: `${NOMBRE[p.ia]} no devolvió texto.` };
}

/** Respuesta por partes, a medida que la escribe. */
async function enVivoOpenAI(
  p: Proveedor,
  mensajes: Mensaje[],
  imagenes: ImagenActual[],
  instruccion: string,
  extra: string | undefined,
  alEscribir: (texto: string) => void,
  signal: AbortSignal
): Promise<Resultado> {
  const { modelo, cuerpo } = cuerpoOpenAI(p, mensajes, imagenes, instruccion, true, extra);
  let respuesta: Response;
  try {
    respuesta = await pedirOpenAI(p, cuerpo, signal);
  } catch (e) {
    console.error(`[asistente ${p.ia}] red`, e);
    return { ok: false, error: signal.aborted ? "Se canceló." : `No se pudo contactar a ${NOMBRE[p.ia]}.` };
  }
  if (!respuesta.ok || !respuesta.body) return { ok: false, error: await p.error(respuesta, modelo) };

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
    console.error(`[asistente ${p.ia}] corte`, e);
    if (!todo) return { ok: false, error: `${NOMBRE[p.ia]} cortó la respuesta. Intenta de nuevo.` };
  }
  return todo.trim() ? { ok: true, texto: todo } : { ok: false, error: `${NOMBRE[p.ia]} no devolvió texto.` };
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

// ------------------------------------------------------------------ datos del panel

/** Hasta cuántas consultas del panel por pregunta. */
const MAX_CONSULTAS = 4;
/** Lo más largo que va a las IA de cada consulta. */
const MAX_JSON_CONSULTA = 7000;

/** Marca con la que empiezan los datos dentro del mensaje (la reconocen las pruebas). */
export const ENCABEZADO_DATOS = "Datos del panel (consultados";

/**
 * Si la pregunta puede necesitar datos del panel. Es un filtro amplio para no
 * gastar una llamada en «redacta un correo» o «una fórmula de Excel»: si pasa,
 * la IA decide de verdad si consulta algo. Mira también la pregunta anterior,
 * por si la última es «¿y ayer?».
 */
const PALABRAS_PANEL =
  /cartera|punto|pdv|asign|libre|auditor|hallazg|revis|pendient|consultor|vendedor|carga|cargu|cargo|ciclo|departament|ciudad|municipio|region|territori|actividad|foto|imagen|panel|ruta|coordenad|ubicaci|cuant|como va|como esta|como vamos|avance|estado|hoy|ayer|semana|mes\b|resumen|cifra|total|ranking|quien/;

function pareceDelPanel(mensajes: Mensaje[]): boolean {
  const usuario = mensajes.filter((m) => m.rol === "usuario").slice(-2);
  const texto = usuario
    .map((m) => m.texto)
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return PALABRAS_PANEL.test(texto);
}

function instruccionConsultas(): string {
  const hoyDia = diaBogota(new Date());
  const lunes = (() => {
    const d = new Date(`${hoyDia}T12:00:00Z`).getUTCDay(); // 0 domingo
    return sumarDias(hoyDia, -((d + 6) % 7));
  })();
  return `Eres el planificador de consultas del asistente del panel de cartera LiveTrade (Overall Colombia). Hoy es ${hoy()}, hora de Colombia.
Decide si para responder el ÚLTIMO mensaje del usuario hacen falta datos del panel que traen las funciones disponibles.
- Si hacen falta, llama de una vez a todas las funciones necesarias (máximo ${MAX_CONSULTAS}), con fechas en formato AAAA-MM-DD: hoy = ${hoyDia}, ayer = ${sumarDias(hoyDia, -1)}, esta semana = desde el lunes ${lunes} hasta hoy, este mes = desde ${hoyDia.slice(0, 8)}01.
- Si la pregunta no necesita datos del panel (saludos, redacción, fórmulas, explicaciones, preguntas generales o lo que se responde con los archivos adjuntos), no llames ninguna función y responde solo «sin consultas».
- No inventes funciones ni parámetros.`;
}

/** La conversación para el planificador: solo el texto de los últimos mensajes. */
function conversacionCorta(mensajes: Mensaje[]) {
  return mensajes.slice(-6).map((m, i, todos) => ({
    rol: m.rol,
    texto: (m.texto || (m.rol === "usuario" ? "(Sin texto: mira los archivos.)" : "…")).slice(0, i === todos.length - 1 ? 4000 : 1500),
  }));
}

type Pedido = { nombre: string; args: Record<string, unknown> };

function argumentos(crudo: unknown): Record<string, unknown> {
  if (crudo && typeof crudo === "object" && !Array.isArray(crudo)) return crudo as Record<string, unknown>;
  if (typeof crudo === "string") {
    try {
      const j = JSON.parse(crudo || "{}");
      return j && typeof j === "object" && !Array.isArray(j) ? j : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Groq o GPT-4o eligen las consultas (llamadas a funciones, formato OpenAI). */
async function planOpenAI(
  p: Proveedor,
  mensajes: Mensaje[],
  consultas: ConsultaPanel[],
  signal: AbortSignal
): Promise<{ ok: true; pedidos: Pedido[] } | { ok: false; error: string }> {
  const modelo = p.modelo(false);
  const cuerpo: Record<string, unknown> = {
    model: modelo,
    messages: [
      { role: "system", content: instruccionConsultas() },
      ...conversacionCorta(mensajes).map((m) => ({ role: m.rol === "usuario" ? "user" : "assistant", content: m.texto })),
    ],
    tools: consultas.map((c) => ({
      type: "function",
      function: { name: c.nombre, description: c.descripcion, parameters: c.parametros },
    })),
    tool_choice: "auto",
    temperature: 0.1,
  };
  p.ajustar(cuerpo, modelo, "plan");
  let respuesta: Response;
  try {
    respuesta = await pedirOpenAI(p, JSON.stringify(cuerpo), signal);
  } catch (e) {
    console.error(`[asistente plan ${p.ia}] red`, e);
    return { ok: false, error: signal.aborted ? "Se canceló." : `No se pudo contactar a ${NOMBRE[p.ia]}.` };
  }
  if (!respuesta.ok) return { ok: false, error: await p.error(respuesta, modelo) };
  const json = await respuesta.json().catch(() => null);
  const llamadas = (json?.choices?.[0]?.message?.tool_calls ?? []) as { function?: { name?: string; arguments?: unknown } }[];
  return {
    ok: true,
    pedidos: llamadas
      .filter((l) => typeof l.function?.name === "string")
      .map((l) => ({ nombre: l.function!.name!, args: argumentos(l.function!.arguments) })),
  };
}

/** Gemini elige las consultas (function calling). */
async function planGemini(mensajes: Mensaje[], consultas: ConsultaPanel[], signal: AbortSignal): Promise<{ ok: true; pedidos: Pedido[] } | { ok: false; error: string }> {
  const cuerpo = {
    systemInstruction: { parts: [{ text: instruccionConsultas() }] },
    contents: conversacionCorta(mensajes).map((m) => ({ role: m.rol === "usuario" ? "user" : "model", parts: [{ text: m.texto }] })),
    tools: [
      {
        functionDeclarations: consultas.map((c) =>
          // Gemini no acepta un objeto de parámetros vacío: sin parámetros, se omite.
          Object.keys(c.parametros.properties).length === 0
            ? { name: c.nombre, description: c.descripcion }
            : { name: c.nombre, description: c.descripcion, parameters: c.parametros }
        ),
      },
    ],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
  };
  let r: Rotacion;
  try {
    r = await rotarGemini("generateContent", JSON.stringify(cuerpo), signal);
  } catch (e) {
    console.error("[asistente plan gemini] red", e);
    return { ok: false, error: signal.aborted ? "Se canceló." : "No se pudo contactar a Gemini." };
  }
  if (!r.respuesta) return { ok: false, error: r.mensaje };
  if (!r.respuesta.ok) return { ok: false, error: await errorGemini(r.respuesta, r.modelo, r.probados) };
  const json = await r.respuesta.json().catch(() => null);
  const partes = (json?.candidates?.[0]?.content?.parts ?? []) as { functionCall?: { name?: string; args?: unknown } }[];
  return {
    ok: true,
    pedidos: partes
      .filter((p) => typeof p.functionCall?.name === "string")
      .map((p) => ({ nombre: p.functionCall!.name!, args: argumentos(p.functionCall!.args) })),
  };
}

/** Lo que salió de consultar el panel para una pregunta. */
type DatosConsultados = {
  /** El texto que se agrega a la pregunta para las IA; null si no se consultó nada. */
  bloque: string | null;
  resumen: { titulo: string; ok: boolean; error?: string }[];
};

/**
 * Antes de responder: una IA decide qué consultas del panel hacen falta
 * (Groq; si falla, Gemini y después GPT-4o), se ejecutan aquí con los
 * permisos del usuario y los datos se agregan a su pregunta para que las IA
 * respondan con cifras reales.
 */
async function consultarPanel(
  mensajes: Mensaje[],
  permisos: PermisosPanel,
  consultas: ConsultaPanel[],
  orden: IA[],
  emitir: (e: Evento) => void,
  signal: AbortSignal
): Promise<DatosConsultados> {
  emitir({ t: "estado", texto: "Revisando si hacen falta datos del panel…" });

  let pedidos: Pedido[] | null = null;
  const fallas: string[] = [];
  for (const ia of orden) {
    const plan =
      ia === "gemini" ? await planGemini(mensajes, consultas, signal) : await planOpenAI(PROVEEDOR[ia], mensajes, consultas, signal);
    if (signal.aborted) return { bloque: null, resumen: [] };
    if (plan.ok) {
      pedidos = plan.pedidos;
      break;
    }
    fallas.push(plan.error);
  }

  if (pedidos === null) {
    // Sin quién decida, se responde sin datos, pero las IA lo saben y no inventan cifras.
    return {
      bloque: `${ENCABEZADO_DATOS} ahora, ${ahoraLegible()}):\nNo se pudieron consultar los datos del panel (${fallas.join(" ")}). Si la pregunta necesita cifras del panel, dile al usuario que no se pudieron consultar y que intente de nuevo; no inventes cifras.`,
      resumen: [{ titulo: "Datos del panel", ok: false, error: "No se pudo decidir qué consultar." }],
    };
  }

  // Sin repetir la misma consulta con los mismos parámetros, y con tope.
  const vistos = new Set<string>();
  const unicos = pedidos
    .filter((p) => {
      const llave = `${p.nombre}:${JSON.stringify(p.args)}`;
      if (vistos.has(llave)) return false;
      vistos.add(llave);
      return true;
    })
    .slice(0, MAX_CONSULTAS);
  if (unicos.length === 0) return { bloque: null, resumen: [] };

  const titulos = unicos.map((p) => consultas.find((c) => c.nombre === p.nombre)?.titulo ?? p.nombre);
  emitir({ t: "estado", texto: `Consultando el panel: ${titulos.join(", ")}…` });
  const resultados: ResultadoConsulta[] = await Promise.all(
    unicos.map((p, i) =>
      ejecutarConsulta(p.nombre, p.args, {
        ...permisos,
        signal,
        avisar: (texto) => emitir({ t: "estado", texto: `${titulos[i]}: ${texto}` }),
      })
    )
  );
  if (signal.aborted) return { bloque: null, resumen: [] };

  const partes = resultados.map((r) => {
    const parametros = Object.keys(r.args).length ? ` ${JSON.stringify(r.args)}` : "";
    const cuerpo = r.ok ? JSON.stringify(r.datos) : JSON.stringify({ error: r.error });
    const recortado = cuerpo.length > MAX_JSON_CONSULTA ? `${cuerpo.slice(0, MAX_JSON_CONSULTA)}… (recortado)` : cuerpo;
    return `### ${r.titulo} (${r.nombre}${parametros})\n${recortado}`;
  });
  return {
    bloque: `${ENCABEZADO_DATOS} ahora, ${ahoraLegible()}, hora de Colombia, con los permisos de ${permisos.usuario}). Son datos reales del sistema, en JSON: respóndele al usuario con estas cifras exactas y di de qué módulo salen. Si una consulta trae "error", explícale que esa parte no se pudo consultar. No inventes cifras que no estén aquí.\n\n${partes.join("\n\n")}`,
    resumen: resultados.map((r) => (r.ok ? { titulo: r.titulo, ok: true } : { titulo: r.titulo, ok: false, error: r.error })),
  };
}

/** La misma conversación, con los datos del panel al final de la última pregunta. */
function conDatos(mensajes: Mensaje[], bloque: string): Mensaje[] {
  const ultimo = mensajes[mensajes.length - 1];
  return [...mensajes.slice(0, -1), { ...ultimo, texto: `${ultimo.texto || "(Sin texto.)"}\n\n---\n${bloque}` }];
}

// ------------------------------------------------------------------ conversación

export function hayGemini() {
  return Boolean(process.env.GEMINI_API_KEY);
}
export function hayGroq() {
  return Boolean(process.env.GROQ_API_KEY);
}
export function hayOpenRouter() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

const LLAVE: Record<IA, string> = { groq: "GROQ_API_KEY", gemini: "GEMINI_API_KEY", openrouter: "OPENROUTER_API_KEY" };

/**
 * En qué orden responden en cada modo de una sola IA: la elegida y, si falla,
 * las demás. Groq es la principal, Gemini la secundaria y GPT-4o el respaldo.
 */
const ORDEN: Record<Exclude<Modo, "combinado">, IA[]> = {
  groq: ["groq", "gemini", "openrouter"],
  gemini: ["gemini", "groq", "openrouter"],
  openrouter: ["openrouter", "groq", "gemini"],
};

/**
 * Responde el último mensaje de la conversación según el modo, y va contando
 * lo que pasa con `emitir` para que la pantalla lo muestre en vivo.
 */
export async function conversar(
  mensajes: Mensaje[],
  imagenes: ImagenActual[],
  modoPedido: Modo,
  emitir: (e: Evento) => void,
  signal: AbortSignal,
  /** Con quién se habla: decide qué datos del panel se pueden consultar. Sin esto, no se consulta nada. */
  permisos?: PermisosPanel
): Promise<void> {
  const hay: Record<IA, boolean> = { groq: hayGroq(), gemini: hayGemini(), openrouter: hayOpenRouter() };

  if (!hay.groq && !hay.gemini && !hay.openrouter) {
    emitir({
      t: "error",
      mensaje:
        "Faltan las llaves de las IA. Agrega GROQ_API_KEY, GEMINI_API_KEY u OPENROUTER_API_KEY en el entorno del proyecto y vuelve a desplegar.",
    });
    return;
  }

  const hayPdf = mensajes.some((m) => (m.adjuntos ?? []).some((a) => a.tipo === "archivo" && a.mime === "application/pdf"));
  /** Si esa IA ve todos los archivos de la conversación (Gemini los ve todos). */
  const veTodo = (ia: IA) => ia === "gemini" || ciegosDe(PROVEEDOR[ia], mensajes, imagenes).size === 0;
  const pdfSin = (ia: IA) => (hayPdf && ia !== "gemini" ? `${NOMBRE[ia]} no abre PDF: la respuesta no tiene en cuenta el PDF.` : "");
  const juntar = (...partes: (string | undefined)[]) => partes.filter(Boolean).join(" ") || undefined;

  let modo = modoPedido;
  let aviso: string | undefined;
  if (modo === "combinado" && !(hay.groq && hay.gemini)) {
    // Sin una de las dos, responde la que haya (o GPT-4o).
    if (hay.groq) {
      modo = "groq";
      aviso = "Respondió solo Groq: falta GEMINI_API_KEY.";
    } else if (hay.gemini) {
      modo = "gemini";
      aviso = "Respondió solo Gemini: falta GROQ_API_KEY.";
    } else {
      modo = "openrouter";
      aviso = "Respondió solo GPT-4o: faltan GROQ_API_KEY y GEMINI_API_KEY.";
    }
  }

  const escribir = (texto: string) => emitir({ t: "texto", texto });
  /** Con qué modelo respondió Gemini, para mostrarlo debajo de la respuesta. */
  const modelos: Partial<Record<IA, string>> = {};

  // ---------------------------------------------------------- datos del panel
  const consultas = permisos ? consultasPara(permisos.rol, permisos.modulos) : [];
  const base = instruccionBase(permisos ? consultas.map((c) => c.titulo) : null);
  let conversacion = mensajes;
  if (permisos && consultas.length > 0 && pareceDelPanel(mensajes)) {
    const orden = (modo === "combinado" ? ORDEN.groq : ORDEN[modo]).filter((ia) => hay[ia]);
    const datos = await consultarPanel(mensajes, permisos, consultas, orden, emitir, signal);
    if (signal.aborted) return;
    if (datos.resumen.length > 0) emitir({ t: "datos", consultas: datos.resumen });
    if (datos.bloque) conversacion = conDatos(mensajes, datos.bloque);
  }

  const enVivo = (ia: IA, instruccion: string, extra?: string) =>
    ia === "gemini"
      ? geminiEnVivo(conversacion, instruccion, extra, escribir, signal)
      : enVivoOpenAI(PROVEEDOR[ia], conversacion, imagenes, instruccion, extra, escribir, signal);

  // ---------------------------------------------------------- una sola IA
  if (modo !== "combinado") {
    const pedida = modo;
    let cadena = ORDEN[pedida];
    let avisoPrevio = aviso;
    if (hayPdf && pedida !== "gemini" && hay.gemini) {
      // Groq y GPT-4o no abren PDF: ese lo lee Gemini.
      cadena = ["gemini", ...cadena.filter((ia) => ia !== "gemini")];
      avisoPrevio = juntar(avisoPrevio, `${NOMBRE[pedida]} no abre PDF: respondió Gemini.`);
    }
    const disponibles = cadena.filter((ia) => hay[ia]);
    const errores: string[] = hay[pedida] ? [] : [`falta ${LLAVE[pedida]}.`];

    for (const [i, ia] of disponibles.entries()) {
      emitir({
        t: "estado",
        texto: i === 0 ? `${NOMBRE[ia]} está respondiendo…` : `${NOMBRE[disponibles[i - 1]]} no pudo responder. Ahora responde ${NOMBRE[ia]}…`,
      });
      const r = await enVivo(ia, base);
      if (r.ok) {
        if (r.modelo) modelos[ia] = r.modelo;
        const primera = i === 0 && errores.length === 0;
        return emitir({
          t: "fin",
          modelos: { ...modelos },
          fuentes: [ia],
          aviso: primera ? juntar(avisoPrevio, ia === pedida ? pdfSin(ia) : "") : juntar(`Respondió ${NOMBRE[ia]}:`, ...errores, pdfSin(ia)),
        });
      }
      if (signal.aborted) return;
      errores.push(r.error);
    }
    return emitir({ t: "error", mensaje: errores.filter((e) => !e.startsWith("falta ")).join(" ") || errores.join(" ") });
  }

  // ---------------------------------------------------------- Groq y Gemini juntas
  emitir({ t: "estado", texto: "Groq y Gemini están respondiendo…" });
  const [deGroq, deGemini] = await Promise.all([
    respuestaOpenAI(GROQ, conversacion, imagenes, base, signal).then((r) => {
      emitir({ t: "borrador", ia: "groq", ...(r.ok ? { texto: r.texto } : { error: r.error }) });
      return r;
    }),
    gemini(conversacion, base, signal).then((r) => {
      emitir({ t: "borrador", ia: "gemini", ...(r.ok ? { texto: r.texto } : { error: r.error }) });
      return r;
    }),
  ]);

  if (signal.aborted) return;
  if (deGemini.ok && deGemini.modelo) modelos.gemini = deGemini.modelo;

  if (!deGroq.ok && !deGemini.ok) {
    // Las dos fallaron: responde GPT-4o, el respaldo.
    if (!hay.openrouter) return emitir({ t: "error", mensaje: `${deGroq.error} ${deGemini.error}` });
    emitir({ t: "estado", texto: "Groq y Gemini no pudieron responder. Ahora responde GPT-4o…" });
    const r = await enVivo("openrouter", base);
    if (signal.aborted) return;
    if (!r.ok) return emitir({ t: "error", mensaje: `${deGroq.error} ${deGemini.error} ${r.error}` });
    return emitir({ t: "fin", modelos: { ...modelos }, fuentes: ["openrouter"], aviso: juntar("Respondió GPT-4o:", deGroq.error, deGemini.error, pdfSin("openrouter")) });
  }

  // Si una falló, la respuesta es la de la otra, tal cual.
  if (!deGroq.ok || !deGemini.ok) {
    const fuente: IA = deGroq.ok ? "groq" : "gemini";
    const buena = (deGroq.ok ? deGroq : deGemini) as { ok: true; texto: string };
    const mala = (deGroq.ok ? deGemini : deGroq) as { ok: false; error: string };
    escribir(buena.texto);
    return emitir({ t: "fin", modelos: { ...modelos }, fuentes: [fuente], aviso: juntar(`Respondió solo ${NOMBRE[fuente]}:`, mala.error, pdfSin(fuente)) });
  }

  // Groq escribe la respuesta final. Si hay algo que Groq no ve (un PDF, una
  // imagen de antes), la escribe Gemini, que sí lo ve.
  const editor: IA = veTodo("groq") ? "groq" : "gemini";
  emitir({ t: "estado", texto: "Combinando las dos respuestas…" });
  const borradores = `--- Borrador A ---\n${deGroq.texto}\n\n--- Borrador B ---\n${deGemini.texto}\n\n--- Fin de los borradores ---\nEscribe ahora la respuesta final al último mensaje del usuario.`;
  const final = await enVivo(editor, base + INSTRUCCION_SINTESIS, borradores);
  if (final.ok && final.modelo) modelos[editor] = final.modelo;

  if (!final.ok) {
    if (signal.aborted) return;
    // Sin síntesis, al menos la respuesta de la que iba a combinar.
    const propia = editor === "groq" ? deGroq : deGemini;
    escribir(propia.texto);
    return emitir({
      t: "fin",
      modelos: { ...modelos },
      fuentes: [editor],
      aviso: `No se pudieron combinar las respuestas (${final.error}). Esta es la de ${NOMBRE[editor]}.`,
    });
  }
  emitir({ t: "fin", modelos: { ...modelos }, fuentes: ["groq", "gemini"], aviso });
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

// ------------------------------------------------------------------ preguntas con fotos

/**
 * Una pregunta corta sobre unas fotos, sin conversación: la usa la Auditoría
 * con query para confirmar fotos repetidas. Responde Gemini (que ve mejor las
 * fotos); si no está o falla, GPT-4o. Groq no entra: su modelo de imágenes
 * solo acepta tres.
 */
export async function preguntarConImagenes(
  instruccion: string,
  pregunta: string,
  imagenes: ImagenActual[],
  signal: AbortSignal,
  /**
   * preferido y familias: qué modelos de Gemini usar (ver OpcionesRotacion).
   * sinRespaldo: no pasar a GPT-4o (que cobra) si Gemini no puede.
   * referencias: imágenes que van antes de las fotos, cada una con su
   *   rótulo, para mostrarle a la IA cómo es lo que busca (no se numeran).
   *   Solo con Gemini: quien las use debe pedir sinRespaldo.
   */
  opciones: {
    preferido?: string;
    sinRespaldo?: boolean;
    referencias?: { rotulo: string; imagen: ImagenActual }[];
  } & OpcionesRotacion = {}
): Promise<{ ok: true; texto: string; ia: IA; modelo?: string } | { ok: false; error: string; esperaMs?: number | null }> {
  const errores: string[] = [];
  let esperaMs: number | null = null;

  if (hayGemini()) {
    try {
      const partes = [
        { text: pregunta },
        ...(opciones.referencias ?? []).flatMap((r) => [
          { text: r.rotulo },
          { inline_data: { mime_type: r.imagen.mime, data: r.imagen.datos } },
        ]),
        ...imagenes.flatMap((img, i) => [
          { text: `Foto ${i + 1}:` },
          { inline_data: { mime_type: img.mime, data: img.datos } },
        ]),
      ];
      const r = await rotarGemini(
        "generateContent",
        JSON.stringify({
          systemInstruction: { parts: [{ text: instruccion }] },
          contents: [{ role: "user", parts: partes }],
          generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: "application/json" },
        }),
        signal,
        opciones.preferido ?? modeloGemini(),
        { familias: opciones.familias }
      );
      esperaMs = r.esperaMs;
      if (!r.respuesta) {
        errores.push(r.mensaje);
      } else if (r.respuesta.ok) {
        const json = await r.respuesta.json().catch(() => null);
        const texto = textoDeRespuestaGemini(json).trim();
        if (texto) return { ok: true, texto, ia: "gemini", modelo: r.modelo };
        errores.push(motivoVacioGemini(json));
      } else {
        errores.push(await errorGemini(r.respuesta, r.modelo, r.probados));
      }
    } catch (e) {
      console.error("[fotos gemini] red", e);
      errores.push(signal.aborted ? "Se canceló." : "No se pudo contactar a Gemini.");
    }
  }

  if (hayOpenRouter() && !signal.aborted && !opciones.sinRespaldo) {
    const r = await respuestaOpenAI(OPENROUTER, [{ rol: "usuario", texto: pregunta }], imagenes, instruccion, signal);
    if (r.ok) return { ok: true, texto: r.texto, ia: "openrouter" };
    errores.push(r.error);
  }

  return {
    ok: false,
    esperaMs,
    error: errores.length
      ? errores.join(" ")
      : "No hay IA configurada para ver fotos: falta GEMINI_API_KEY u OPENROUTER_API_KEY.",
  };
}
