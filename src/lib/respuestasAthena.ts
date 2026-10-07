/**
 * Lo que responden las rutas que consultan Athena (lib/rutaAthena.ts) y lo
 * que espera el navegador (components/ConsultaAthena.tsx). Solo tipos.
 */

export type EstadoAthena = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export type RespuestaInicio = { id: string };

export type RespuestaEstado = {
  estado: EstadoAthena;
  error: string | null;
  enviada: string | null;
  terminada: string | null;
  bytesEscaneados: number;
  reutilizada: boolean;
};

export type RespuestaPagina = {
  columnas: string[];
  filas: (string | null)[][];
  siguiente: string | null;
};
