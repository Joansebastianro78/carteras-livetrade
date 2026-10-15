/**
 * Rotación de modelos de Gemini. SOLO SERVIDOR.
 *
 * En el plan gratis de Google el cupo es por modelo (Gemini 3.8 Flash: 20
 * peticiones al día; 3.5 Flash Lite: 500…). En vez de quedarse con uno, cada
 * llamada prueba el modelo preferido y, si ese ya agotó su cupo (429), no
 * existe para la cuenta (404) o está saturado (503), pasa al siguiente.
 *
 * Qué modelos hay se le pregunta a la propia cuenta (GET /v1beta/models) y se
 * recuerda seis horas: así no hay que adivinar los nombres técnicos ni tocar
 * el código cuando Google saque otro. Quedan los de texto (Flash, Flash Lite,
 * Pro), en ese orden y del más nuevo al más viejo; fuera quedan los de voz,
 * imagen, video, música, en vivo, embeddings y similares, que no sirven
 * para esto.
 *
 * Cuando un modelo agota su cupo del día, no se vuelve a probar hasta la
 * medianoche del Pacífico (cuando Google lo renueva); si es el cupo por
 * minuto, hasta lo que diga Google. Eso se recuerda en la memoria del
 * servidor: si Vercel arranca otra instancia, a lo sumo prueba una vez de más.
 *
 * GEMINI_MODELOS (opcional) fija la lista a mano, separada por comas y en
 * orden. Con un solo modelo, no hay rotación.
 */

export type PedirGemini = (
  ruta: string,
  init: { method: string; headers?: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal }
) => Promise<Response>;

/** Más que esto por pregunta solo hace esperar: si fallan tantos, algo más pasa. */
const MAX_INTENTOS = 15;
const CATALOGO_MS = 6 * 60 * 60 * 1000;

/** Modelos que no son de texto (o no sirven para conversar y ver archivos). */
const NO_SIRVE =
  /(tts|image|imagen|live|audio|embed|transcrib|robotics|computer|veo|lyria|omni|banana|deep-research|antigravity|aqa|learnlm|nano|translate|thinking-exp)/;

let catalogo: { modelos: string[]; hasta: number } | null = null;
const enfriados = new Map<string, { hasta: number; motivo: string }>();

// ------------------------------------------------------------------ orden

export type Familia = "flash" | "lite" | "pro" | "otro";
const FAMILIAS: Familia[] = ["flash", "lite", "pro", "otro"];

/**
 * Para trabajos de muchas fotos (las etiquetas de la Auditoría con query) se
 * usan solo los Flash Lite, que tienen cupo de cientos al día: así no se gasta
 * el cupo de los Flash, que es el del asistente.
 */
export type OpcionesRotacion = { familias?: Familia[] };

export function familiaDe(id: string): Familia {
  return FAMILIAS[familia(id)];
}

function familia(id: string): number {
  if (/flash-lite/.test(id)) return 1;
  if (/flash/.test(id)) return 0;
  if (/pro/.test(id)) return 2;
  return 3;
}

function version(id: string): number {
  const m = id.match(/^gemini-(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

/**
 * Los modelos de texto de la cuenta, en el orden en que se prueban: Flash,
 * Flash Lite, Pro y otros; en cada grupo, del más nuevo al más viejo. Se
 * quitan los alias (…-latest) y las versiones con fecha (…-001, …-09-2025)
 * que repiten a otro, y la vista previa si ya está el estable.
 */
export function ordenarModelos(ids: string[]): string[] {
  const unicos = [...new Set(ids.map((i) => i.replace(/^models\//, "").trim()).filter(Boolean))];
  const sirven = unicos.filter((id) => /^gemini-/.test(id) && !NO_SIRVE.test(id) && !/-latest$/.test(id));
  const sinFecha = sirven.filter((id) => {
    const base = id.replace(/-(\d{3}|\d{2}-\d{4}|\d{4}-\d{2}-\d{2}|\d{2}-\d{2})$/, "");
    return base === id || !sirven.includes(base);
  });
  const finales = sinFecha.filter((id) => !/-preview/.test(id) || !sinFecha.includes(id.replace(/-preview.*$/, "")));
  return finales.sort(
    (a, b) =>
      familia(a) - familia(b) ||
      version(b) - version(a) ||
      Number(/preview/.test(a)) - Number(/preview/.test(b)) ||
      a.localeCompare(b)
  );
}

async function modelosDeLaCuenta(pedir: PedirGemini): Promise<string[]> {
  if (catalogo && catalogo.hasta > Date.now()) return catalogo.modelos;
  try {
    const ids: string[] = [];
    let pagina = "";
    for (let i = 0; i < 5; i++) {
      const r = await pedir(`/v1beta/models?pageSize=1000${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ""}`, {
        method: "GET",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as {
        models?: { name?: string; supportedGenerationMethods?: string[] }[];
        nextPageToken?: string;
      };
      for (const m of j.models ?? []) {
        if (m.name && (m.supportedGenerationMethods ?? []).includes("generateContent")) ids.push(m.name);
      }
      pagina = j.nextPageToken ?? "";
      if (!pagina) break;
    }
    catalogo = { modelos: ordenarModelos(ids), hasta: Date.now() + CATALOGO_MS };
    console.info(`[gemini] modelos de la cuenta: ${catalogo.modelos.join(", ") || "ninguno"}`);
  } catch (e) {
    // Sin la lista se usa solo el preferido; se vuelve a pedir en cinco minutos.
    console.error("[gemini] no se pudo leer la lista de modelos:", (e as Error).message);
    catalogo = { modelos: [], hasta: Date.now() + 5 * 60 * 1000 };
  }
  return catalogo.modelos;
}

/** Los modelos que se van a probar, en orden, sin los que están descansando. */
async function modelosParaUsar(
  pedir: PedirGemini,
  preferido: string,
  opciones: OpcionesRotacion = {}
): Promise<{ libres: string[]; todos: string[] }> {
  const fijos = (process.env.GEMINI_MODELOS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let lista = fijos.length ? fijos : [preferido, ...(await modelosDeLaCuenta(pedir)).filter((m) => m !== preferido)];
  if (opciones.familias) {
    const solo = lista.filter((m) => opciones.familias!.includes(familiaDe(m)));
    // Si la cuenta no tiene de esa familia, mejor cualquiera que ninguno.
    if (solo.length > 0) lista = solo;
  }
  const ahora = Date.now();
  return { libres: lista.filter((m) => (enfriados.get(m)?.hasta ?? 0) <= ahora).slice(0, MAX_INTENTOS), todos: lista };
}

// ------------------------------------------------------------------ fallas

/** Cuándo vuelve a amanecer en el Pacífico, que es cuando Google renueva el cupo diario. */
export function proximaRenovacion(ahora = Date.now()): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ahora));
  const valor = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  const transcurridos = valor("hour") * 3600 + valor("minute") * 60 + valor("second");
  return ahora + (86_400 - transcurridos) * 1000 + 60_000;
}

type CuerpoError = {
  error?: {
    message?: string;
    details?: {
      "@type"?: string;
      retryDelay?: string;
      violations?: { quotaId?: string; quotaValue?: string }[];
    }[];
  };
};

/**
 * Anota por qué falló ese modelo y si vale la pena probar el siguiente. Las
 * fallas de la llave (401, 403) o de la pregunta (400) no son del modelo.
 */
async function anotarFalla(modelo: string, respuesta: Response): Promise<boolean> {
  const ahora = Date.now();
  const json = (await respuesta.json().catch(() => null)) as CuerpoError | null;
  const mensaje = json?.error?.message ?? "";

  if (respuesta.status === 429) {
    const detalles = json?.error?.details ?? [];
    const violaciones = detalles.flatMap((d) => d.violations ?? []);
    const diario = violaciones.some((v) => /PerDay/i.test(v.quotaId ?? "")) || /per day|perday/i.test(mensaje);
    const sinCupo = violaciones.some((v) => v.quotaValue === "0") || /limit: 0\b/.test(mensaje);
    const espera = Number(detalles.find((d) => d.retryDelay)?.retryDelay?.replace(/s$/, ""));
    const hasta = diario || sinCupo ? proximaRenovacion(ahora) : ahora + (Number.isFinite(espera) && espera > 0 ? espera : 60) * 1000;
    enfriados.set(modelo, { hasta, motivo: sinCupo ? "sin cupo en esta cuenta" : diario ? "cupo del día agotado" : "cupo por minuto" });
    return true;
  }
  if (respuesta.status === 404) {
    enfriados.set(modelo, { hasta: ahora + 24 * 3600 * 1000, motivo: "no existe para esta cuenta" });
    return true;
  }
  if (respuesta.status === 503) {
    enfriados.set(modelo, { hasta: ahora + 60_000, motivo: "saturado" });
    return true;
  }
  if (respuesta.status >= 500) return true;
  if (respuesta.status === 400 && /not supported|not enabled|unsupported|no soport/i.test(mensaje)) {
    enfriados.set(modelo, { hasta: ahora + 24 * 3600 * 1000, motivo: "no admite esta petición" });
    return true;
  }
  return false;
}

function horaColombia(ms: number): string {
  return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

// ------------------------------------------------------------------ rotar

/** esperaMs: si todos los modelos están descansando, cuánto falta para que se libere el primero. */
export type Rotacion =
  | { respuesta: Response; modelo: string; probados: string[]; esperaMs: number | null }
  | { respuesta: null; mensaje: string; probados: string[]; esperaMs: number | null };

function esperaHastaLibre(todos: string[]): number | null {
  const ahora = Date.now();
  if (todos.length === 0) return null;
  const proximo = Math.min(...todos.map((m) => enfriados.get(m)?.hasta ?? ahora));
  return proximo > ahora ? proximo - ahora : null;
}

/**
 * Prueba la petición con cada modelo hasta que uno responda bien. Devuelve
 * esa respuesta y qué modelo la dio; o, si todos fallaron, la última falla
 * (para explicar el error) con la lista de los que se probaron. Los errores
 * de red (o cancelar) se dejan pasar: no son culpa del modelo.
 */
export async function conRotacion(
  pedir: PedirGemini,
  preferido: string,
  intento: (modelo: string) => Promise<Response>,
  opciones: OpcionesRotacion = {}
): Promise<Rotacion> {
  const { libres, todos } = await modelosParaUsar(pedir, preferido, opciones);
  if (libres.length === 0) {
    const proximo = Math.min(...todos.map((m) => enfriados.get(m)?.hasta ?? Infinity));
    return {
      respuesta: null,
      probados: [],
      esperaMs: esperaHastaLibre(todos),
      mensaje: `Gemini llegó al cupo en sus ${todos.length} ${todos.length === 1 ? "modelo" : "modelos"}. ${
        Number.isFinite(proximo) ? `El primero se libera hacia las ${horaColombia(proximo)} (hora de Colombia).` : "Intenta más tarde."
      }`,
    };
  }

  const probados: string[] = [];
  let ultima: Response | null = null;
  let internos = 0;
  for (const modelo of libres) {
    const respuesta = await intento(modelo);
    probados.push(modelo);
    if (respuesta.ok) {
      if (probados.length > 1) console.info(`[gemini] respondió ${modelo} después de probar ${probados.slice(0, -1).join(", ")}`);
      return { respuesta, modelo, probados, esperaMs: null };
    }
    ultima = respuesta;
    const sigue = await anotarFalla(modelo, respuesta.clone());
    if (!sigue) break;
    // Un error interno puede ser de la pregunta y no del modelo: se prueba uno más y ya.
    if (respuesta.status >= 500 && respuesta.status !== 503 && ++internos >= 2) break;
  }
  return { respuesta: ultima!, modelo: probados[probados.length - 1], probados, esperaMs: esperaHastaLibre(todos) };
}

/** «3.7 Flash», «2.5 Flash Lite»: el nombre del modelo para la pantalla. */
export function nombreModelo(id: string): string {
  return id
    .replace(/^gemini-/, "")
    .split("-")
    .map((p) => (/^\d/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

/** Para las pruebas y el diagnóstico: qué modelos están descansando y por qué. */
export function estadoModelos(): { modelo: string; hasta: string; motivo: string }[] {
  const ahora = Date.now();
  return [...enfriados.entries()]
    .filter(([, e]) => e.hasta > ahora)
    .map(([modelo, e]) => ({ modelo, hasta: new Date(e.hasta).toISOString(), motivo: e.motivo }));
}
