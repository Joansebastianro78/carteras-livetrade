/**
 * Ruta de API que corre UNA consulta fija en Athena. SOLO SERVIDOR.
 *
 * La usan /api/admin/auditoria y /api/admin/auditoria-imagenes, cada una con
 * su SQL:
 *
 *   POST {fresca?}             → lanza la consulta y devuelve su id
 *   GET  ?id=X                 → estado de esa ejecución
 *   GET  ?id=X&pagina=inicio   → primeras 1000 filas
 *   GET  ?id=X&pagina=<token>  → las 1000 siguientes
 *
 * El navegador nunca manda SQL, y solo puede leer las ejecuciones que lanzó
 * la misma ruta (ver "id firmado").
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  AthenaSinConfigurar,
  estadoConsulta,
  explicarError,
  iniciarConsulta,
  nombreError,
  paginaResultados,
} from "./athena";
import type { RespuestaEstado, RespuestaInicio, RespuestaPagina } from "./respuestasAthena";

// ------------------------------------------------------------- id firmado
/**
 * El id que recibe el navegador es "<id de Athena>.<firma>". La firma es un
 * HMAC con ADMIN_SECRET del nombre de la consulta y el id, así que solo la
 * ruta de esa consulta puede emitirla.
 *
 * Sin esto, quien tenga sesión podría pedir el id de cualquier otra consulta
 * del workgroup (las de DBeaver, por ejemplo) y leer su resultado a través de
 * la app. Como cada ruta solo lanza su propio SQL, un id firmado siempre es de
 * esa consulta.
 *
 * No se compara el texto de la consulta que devuelve Athena con el enviado:
 * no hay garantía de que lo devuelva idéntico, y con cualquier diferencia la
 * ruta rechazaba sus propias consultas con "Esa consulta no existe".
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ID_FIRMADO = new RegExp(`^(${UUID})\\.([A-Za-z0-9_-]{43})$`);

function firmar(nombre: string, ejecucion: string): string | null {
  const secreto = process.env.ADMIN_SECRET;
  if (!secreto) return null;
  return createHmac("sha256", secreto)
    .update(`auditoria-athena:${nombre}:${ejecucion}`)
    .digest("base64url");
}

/** El id de Athena si lo emitió la ruta de esta consulta; null si la firma no corresponde. */
function ejecucionDe(nombre: string, idFirmado: string): string | null {
  const m = idFirmado.match(ID_FIRMADO);
  if (!m) return null;
  const esperada = firmar(nombre, m[1]);
  if (!esperada) return null;
  const recibida = Buffer.from(m[2]);
  const correcta = Buffer.from(esperada);
  return recibida.length === correcta.length && timingSafeEqual(recibida, correcta) ? m[1] : null;
}

// -------------------------------------------------------------------- ruta
/**
 * `nombre` identifica la consulta en la firma y en el log del servidor; debe
 * ser distinto en cada ruta para que el id de una no sirva en otra.
 */
export function crearRutaAthena(nombre: string, sql: string) {
  function fallo(paso: string, e: unknown) {
    // El detalle técnico queda en el log del servidor; a la pantalla va explicado.
    console.error(`[athena ${nombre} ${paso}]`, nombreError(e), (e as Error)?.message);
    const sinConfigurar = e instanceof AthenaSinConfigurar;
    return NextResponse.json({ error: explicarError(e) }, { status: sinConfigurar ? 503 : 502 });
  }

  async function POST(req: Request) {
    const cuerpo = (await req.json().catch(() => ({}))) as { fresca?: unknown };

    // Se revisa antes de lanzar: sin secreto no habría cómo entregar el id.
    if (!process.env.ADMIN_SECRET) {
      return NextResponse.json(
        { error: "Falta configurar ADMIN_SECRET en el servidor." },
        { status: 500 }
      );
    }

    try {
      const ejecucion = await iniciarConsulta(sql, cuerpo.fresca === true);
      const respuesta: RespuestaInicio = { id: `${ejecucion}.${firmar(nombre, ejecucion)}` };
      return NextResponse.json(respuesta);
    } catch (e) {
      return fallo("inicio", e);
    }
  }

  async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const pagina = searchParams.get("pagina");

    const ejecucion = ejecucionDe(nombre, searchParams.get("id") ?? "");
    if (!ejecucion) {
      // Mismo mensaje para un id mal formado, ajeno o con la firma alterada.
      return NextResponse.json({ error: "Esa consulta no existe." }, { status: 404 });
    }

    try {
      const estado = await estadoConsulta(ejecucion);

      if (pagina === null) {
        const respuesta: RespuestaEstado = {
          estado: estado.estado,
          error:
            estado.estado === "FAILED" ? (estado.motivo ?? "La consulta falló.") : null,
          enviada: estado.enviada,
          terminada: estado.terminada,
          bytesEscaneados: estado.bytesEscaneados,
          reutilizada: estado.reutilizada,
        };
        return NextResponse.json(respuesta);
      }

      if (estado.estado !== "SUCCEEDED") {
        return NextResponse.json(
          { error: "La consulta todavía no ha terminado." },
          { status: 409 }
        );
      }

      const respuesta: RespuestaPagina = await paginaResultados(
        ejecucion,
        pagina === "inicio" ? null : pagina
      );
      return NextResponse.json(respuesta);
    } catch (e) {
      return fallo(pagina === null ? "estado" : "pagina", e);
    }
  }

  return { POST, GET };
}
