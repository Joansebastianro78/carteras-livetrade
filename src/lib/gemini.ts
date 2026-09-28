/**
 * Cliente de Gemini para analizar tableros.
 *
 * La clave vive solo en el servidor (GEMINI_API_KEY). Nunca se manda al
 * navegador: si estuviera en el cliente, cualquiera la sacaría del código
 * de la página y la gastaría por su cuenta.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Google está limitando los modelos 2.5 a quien ya los venía usando, así que
 * el valor por defecto es de la familia nueva. Se puede cambiar sin tocar
 * código con GEMINI_MODELO (por ejemplo gemini-3.8-flash para un análisis
 * más profundo, a más costo y más demora).
 */
export const MODELO_POR_DEFECTO = "gemini-3.5-flash-lite";

export const INSTRUCCION = `Eres analista de operación de campo para una
compañía de consumo masivo en Colombia. Te van a pasar una captura de un
tablero de Power BI, datos exportados de ese tablero, o ambos.

Responde SIEMPRE en español de Colombia, en tono directo y sin adornos.

Estructura la respuesta así, con estos títulos en negrilla:
**Qué muestra** — dos o tres frases con la foto general y el periodo.
**Hallazgos** — de tres a cinco viñetas con los números que importan. Cita la
cifra exacta que ves y el nombre del indicador tal como aparece.
**Alertas** — lo que se ve mal o raro: caídas, valores en cero, datos que no
cuadran entre sí. Si no hay nada preocupante, dilo en una línea.
**Qué haría** — dos o tres acciones concretas para la operación.

Reglas que no puedes romper:
- No inventes cifras. Si un dato no se alcanza a leer, di que no se lee.
- No calcules porcentajes ni totales que no puedas verificar con lo que ves.
- Si la imagen no es un tablero o no se entiende, dilo en una sola frase y no
  inventes un análisis.
- No repitas cédulas, teléfonos ni nombres de personas que aparezcan en las
  tablas: refiérete a ellos por su rol o su código.`;

export type ParteAnalisis =
  | { texto: string }
  | { imagen: { mimeType: string; datos: string } };

export type ResultadoAnalisis =
  | { ok: true; texto: string }
  | { ok: false; error: string };

export async function analizarConGemini(
  partes: ParteAnalisis[]
): Promise<ResultadoAnalisis> {
  const clave = process.env.GEMINI_API_KEY;
  if (!clave) {
    return {
      ok: false,
      error:
        "Falta la variable GEMINI_API_KEY. Agrégala en el entorno del proyecto y vuelve a desplegar.",
    };
  }

  const modelo = process.env.GEMINI_MODELO || MODELO_POR_DEFECTO;

  const cuerpo = {
    systemInstruction: { parts: [{ text: INSTRUCCION }] },
    contents: [
      {
        role: "user",
        parts: partes.map((p) =>
          "texto" in p
            ? { text: p.texto }
            : { inline_data: { mime_type: p.imagen.mimeType, data: p.imagen.datos } }
        ),
      },
    ],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1400 },
  };

  let respuesta: Response;
  try {
    respuesta = await fetch(`${ENDPOINT}/${modelo}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": clave,
      },
      body: JSON.stringify(cuerpo),
    });
  } catch (e) {
    console.error("[gemini] red", e);
    return { ok: false, error: "No se pudo contactar a Gemini. Intenta de nuevo." };
  }

  const json = await respuesta.json().catch(() => null);

  if (!respuesta.ok) {
    const detalle = json?.error?.message ?? `HTTP ${respuesta.status}`;
    console.error("[gemini]", detalle);

    // El 404 de Gemini casi siempre es un modelo que la cuenta no tiene
    // habilitado, no una ruta mal escrita. Vale la pena decirlo claro.
    if (respuesta.status === 404) {
      return {
        ok: false,
        error: `Tu proyecto de Google no tiene acceso al modelo "${modelo}". Cambia GEMINI_MODELO por uno disponible en tu cuenta.`,
      };
    }
    if (respuesta.status === 429) {
      return {
        ok: false,
        error: "Se agotó la cuota de Gemini por ahora. Espera un momento y reintenta.",
      };
    }
    return { ok: false, error: `Gemini respondió con un error: ${detalle}` };
  }

  const texto = (json?.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("")
    .trim();

  if (!texto) {
    const motivo = json?.candidates?.[0]?.finishReason;
    return {
      ok: false,
      error:
        motivo === "SAFETY"
          ? "Gemini bloqueó la respuesta por sus filtros de contenido."
          : "Gemini no devolvió texto. Prueba con una captura más nítida.",
    };
  }

  return { ok: true, texto };
}
