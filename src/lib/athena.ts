/**
 * Conexión con Amazon Athena para el módulo de auditoría.
 *
 * SOLO SERVIDOR. Las llaves de AWS viven en variables de entorno sin prefijo
 * NEXT_PUBLIC_ y nunca llegan al navegador: con ellas cualquiera podría
 * consultar todo lo que el usuario de AWS tenga permitido.
 *
 * Los nombres empiezan por ATHENA_ y no por AWS_ porque Vercel reserva las
 * variables AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY y AWS_REGION.
 */
import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
  type StartQueryExecutionCommandInput,
} from "@aws-sdk/client-athena";

const env = (nombre: string) => (process.env[nombre] ?? "").trim();

const CONFIG = {
  region: env("ATHENA_REGION") || "us-east-1",
  accessKeyId: env("ATHENA_ACCESS_KEY_ID"),
  secretAccessKey: env("ATHENA_SECRET_ACCESS_KEY"),
  workgroup: env("ATHENA_WORKGROUP") || "workgroup647",
  baseDeDatos: env("ATHENA_DATABASE") || "livetradebi",
  salida: env("ATHENA_OUTPUT") || "s3://mkt-bi-athena-read-cliente-id-647/athena/",
  /**
   * Si alguien ya corrió la misma consulta hace menos de estos minutos, Athena
   * entrega ese resultado sin volver a leer las tablas: no cobra por datos
   * escaneados y responde en un segundo. 0 lo apaga.
   */
  reusoMinutos: Math.max(0, Number(env("ATHENA_REUSO_MINUTOS") || 10) || 0),
};

export class AthenaSinConfigurar extends Error {}

let cliente: AthenaClient | null = null;

function athena(): AthenaClient {
  if (!CONFIG.accessKeyId || !CONFIG.secretAccessKey) {
    throw new AthenaSinConfigurar(
      "Falta configurar la conexión: agrega ATHENA_ACCESS_KEY_ID y ATHENA_SECRET_ACCESS_KEY en el entorno."
    );
  }
  cliente ??= new AthenaClient({
    region: CONFIG.region,
    credentials: {
      accessKeyId: CONFIG.accessKeyId,
      secretAccessKey: CONFIG.secretAccessKey,
    },
  });
  return cliente;
}

// ------------------------------------------------------------- ejecutar
/**
 * Lanza la consulta y devuelve su id sin esperar a que termine: Athena puede
 * tardar más de lo que aguanta una función de Vercel, así que el navegador
 * pregunta por el estado cada segundo o dos.
 *
 * `fresca` pide datos nuevos aunque haya un resultado reciente.
 */
export async function iniciarConsulta(sql: string, fresca = false): Promise<string> {
  const base: StartQueryExecutionCommandInput = {
    QueryString: sql,
    WorkGroup: CONFIG.workgroup,
    QueryExecutionContext: { Catalog: "AwsDataCatalog", Database: CONFIG.baseDeDatos },
    // Si el workgroup impone su propia carpeta de resultados, Athena usa esa.
    ResultConfiguration: { OutputLocation: CONFIG.salida },
  };

  const reusar = !fresca && CONFIG.reusoMinutos > 0;

  try {
    const r = await athena().send(
      new StartQueryExecutionCommand(
        reusar
          ? {
              ...base,
              ResultReuseConfiguration: {
                ResultReuseByAgeConfiguration: {
                  Enabled: true,
                  MaxAgeInMinutes: CONFIG.reusoMinutos,
                },
              },
            }
          : base
      )
    );
    return r.QueryExecutionId!;
  } catch (e) {
    // La reutilización exige el motor 3 de Athena. Si el workgroup no la
    // admite, se ejecuta normal en vez de fallar.
    if (reusar && nombreError(e) === "InvalidRequestException") {
      const r = await athena().send(new StartQueryExecutionCommand(base));
      return r.QueryExecutionId!;
    }
    throw e;
  }
}

export type EstadoConsulta = {
  estado: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  /** Por qué falló, tal como lo explica Athena. */
  motivo: string | null;
  enviada: string | null;
  terminada: string | null;
  bytesEscaneados: number;
  reutilizada: boolean;
};

export async function estadoConsulta(id: string): Promise<EstadoConsulta> {
  const r = await athena().send(new GetQueryExecutionCommand({ QueryExecutionId: id }));
  const q = r.QueryExecution;
  return {
    estado: (q?.Status?.State ?? "QUEUED") as EstadoConsulta["estado"],
    motivo: q?.Status?.StateChangeReason ?? q?.Status?.AthenaError?.ErrorMessage ?? null,
    enviada: q?.Status?.SubmissionDateTime?.toISOString() ?? null,
    terminada: q?.Status?.CompletionDateTime?.toISOString() ?? null,
    bytesEscaneados: q?.Statistics?.DataScannedInBytes ?? 0,
    reutilizada: q?.Statistics?.ResultReuseInformation?.ReusedPreviousResult ?? false,
  };
}

// ------------------------------------------------------------ resultados
export type PaginaResultados = {
  columnas: string[];
  filas: (string | null)[][];
  siguiente: string | null;
};

/** Hasta 1000 filas por llamada, que es lo máximo que entrega Athena. */
export async function paginaResultados(
  id: string,
  token: string | null
): Promise<PaginaResultados> {
  const r = await athena().send(
    new GetQueryResultsCommand({
      QueryExecutionId: id,
      MaxResults: 1000,
      NextToken: token ?? undefined,
    })
  );

  const columnas = (r.ResultSet?.ResultSetMetadata?.ColumnInfo ?? []).map(
    (c) => c.Label || c.Name || ""
  );
  let filas = (r.ResultSet?.Rows ?? []).map((fila) =>
    (fila.Data ?? []).map((celda) => celda.VarCharValue ?? null)
  );

  // En un SELECT, la primera fila de la primera página son los encabezados.
  if (!token && filas.length > 0 && filas[0].every((v, i) => v === columnas[i])) {
    filas = filas.slice(1);
  }

  return { columnas, filas, siguiente: r.NextToken ?? null };
}

// --------------------------------------------------------------- errores
export function nombreError(e: unknown): string {
  return (e as { name?: string })?.name ?? "Error";
}

/** Mensaje para la pantalla. Lo técnico va al log del servidor. */
export function explicarError(e: unknown): string {
  if (e instanceof AthenaSinConfigurar) return e.message;

  switch (nombreError(e)) {
    case "UnrecognizedClientException":
    case "InvalidSignatureException":
    case "InvalidClientTokenId":
    case "SignatureDoesNotMatch":
      return "AWS rechazó las llaves. Revisa ATHENA_ACCESS_KEY_ID y ATHENA_SECRET_ACCESS_KEY.";
    case "AccessDeniedException":
      return "El usuario de AWS no tiene permiso para esta consulta.";
    case "TooManyRequestsException":
    case "ThrottlingException":
      return "El servicio está ocupado en este momento. Intenta de nuevo en un minuto.";
    case "InvalidRequestException":
      return `No se aceptó la consulta: ${(e as Error).message}`;
    default:
      return "No se pudo hacer la consulta. Intenta de nuevo en un momento.";
  }
}
