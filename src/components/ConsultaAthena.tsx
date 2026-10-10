"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import type { RespuestaEstado, RespuestaInicio, RespuestaPagina } from "@/lib/respuestasAthena";

/**
 * Lo que comparten las pestañas que leen de Athena (auditoría de datos y de
 * imágenes): lanzar la consulta, esperar a que termine, traer los resultados
 * y mostrar el avance. Cada pestaña pone su ruta de API y su pantalla.
 */

/** Más que esto ya no cabe con holgura en el navegador. */
const TOPE_FILAS = 200_000;

export type Fase =
  /** Todavía no se ha pedido (consultas que no arrancan solas). */
  | { tipo: "quieto" }
  | { tipo: "lanzando" }
  | { tipo: "esperando"; estado: "QUEUED" | "RUNNING"; desde: number }
  | { tipo: "leyendo"; leidas: number }
  | { tipo: "listo" }
  | { tipo: "error"; mensaje: string };

export type InfoConsulta = { enviada: string | null; bytes: number; reutilizada: boolean };

export const cifra = (n: number) => n.toLocaleString("es-CO");

export const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function megas(bytes: number): string {
  const mb = bytes / 1_048_576;
  return `${mb.toLocaleString("es-CO", { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
}

export function momento(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-CO", {
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Se perdió la conexión con el servidor.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "No se pudo hacer la consulta.");
  return json as T;
}

/**
 * Corre en Athena la consulta de `ruta` (una de las de lib/rutaAthena.ts) al
 * montar el componente y cada vez que se llama consultar(). `aFilas` convierte
 * cada página de Athena en las filas que usa la pantalla.
 *
 * Con `automatica: false` no arranca sola: espera a que se llame consultar().
 */
export function useConsultaAthena<T>(
  ruta: string,
  aFilas: (columnas: string[], filas: (string | null)[][]) => T[],
  { automatica = true }: { automatica?: boolean } = {}
) {
  const [fase, setFase] = useState<Fase>(automatica ? { tipo: "lanzando" } : { tipo: "quieto" });
  const [filas, setFilas] = useState<T[]>([]);
  const [info, setInfo] = useState<InfoConsulta | null>(null);

  const consulta = useRef(0);
  const convertir = useRef(aFilas);
  useEffect(() => {
    convertir.current = aFilas;
  });

  /** `fresca` pide datos nuevos aunque Athena tenga un resultado reciente. */
  const consultar = useCallback(
    async (fresca: boolean) => {
      const id = ++consulta.current;
      const vigente = () => consulta.current === id;

      setFase({ tipo: "lanzando" });
      setFilas([]);
      setInfo(null);

      try {
        const { id: ejecucion } = await pedir<RespuestaInicio>(ruta, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fresca }),
        });
        const conId = `${ruta}?id=${encodeURIComponent(ejecucion)}`;

        // Athena trabaja aparte: se pregunta cada vez con menos prisa.
        const desde = Date.now();
        let estado: RespuestaEstado;
        for (let intento = 0; ; intento++) {
          if (!vigente()) return;
          estado = await pedir<RespuestaEstado>(conId);
          if (!vigente()) return;

          if (estado.estado === "SUCCEEDED") break;
          if (estado.estado === "FAILED") throw new Error(estado.error ?? "La consulta falló.");
          if (estado.estado === "CANCELLED") throw new Error("La consulta se canceló.");

          setFase({ tipo: "esperando", estado: estado.estado, desde });
          await esperar(intento < 5 ? 1000 : intento < 15 ? 2000 : 3000);
        }

        setInfo({
          enviada: estado.enviada,
          bytes: estado.bytesEscaneados,
          reutilizada: estado.reutilizada,
        });

        // Resultados de a 1000 filas, que es lo que entrega Athena por llamada.
        // Se pintan al final: rehacer la lista en cada página solo la vuelve lenta.
        let acumulado: T[] = [];
        let pagina: string | null = "inicio";
        setFase({ tipo: "leyendo", leidas: 0 });

        while (pagina !== null) {
          const r: RespuestaPagina = await pedir<RespuestaPagina>(
            `${conId}&pagina=${encodeURIComponent(pagina)}`
          );
          if (!vigente()) return;

          acumulado = acumulado.concat(convertir.current(r.columnas, r.filas));
          pagina = r.siguiente;
          setFase({ tipo: "leyendo", leidas: acumulado.length });

          if (pagina !== null && acumulado.length >= TOPE_FILAS) {
            throw new Error(
              `La consulta trae más de ${cifra(TOPE_FILAS)} filas y no cabe en el navegador. Descárgala desde DBeaver o pide acotar la consulta.`
            );
          }
        }

        setFilas(acumulado);
        setFase({ tipo: "listo" });
      } catch (e) {
        if (!vigente()) return;
        setFase({ tipo: "error", mensaje: (e as Error).message });
      }
    },
    [ruta]
  );

  // Al abrir la pestaña se consulta sola. Al salir, se deja de preguntar.
  useEffect(() => {
    if (automatica) consultar(false);
    return () => {
      consulta.current++;
    };
  }, [consultar, automatica]);

  return {
    fase,
    filas,
    info,
    consultar,
    trabajando: fase.tipo !== "listo" && fase.tipo !== "error" && fase.tipo !== "quieto",
  };
}

/** "Consultado el 7 de octubre, 6:44 p. m. · 46 MB leídos" (vacío mientras no termine). */
export function textoConsulta(info: InfoConsulta | null): string {
  if (!info) return "";
  const cuando = `Consultado el ${momento(info.enviada)}`;
  if (info.reutilizada) return `${cuando} · resultado de una consulta reciente`;
  return info.bytes > 0 ? `${cuando} · ${megas(info.bytes)} leídos` : cuando;
}

/** Vuelve a consultar pidiendo datos nuevos. */
export function BotonReconsultar({
  trabajando,
  onConsultar,
}: {
  trabajando: boolean;
  onConsultar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onConsultar}
      disabled={trabajando}
      className="boton boton-secundario"
    >
      <RefreshCw size={15} aria-hidden className={trabajando ? "animate-spin" : undefined} />
      Volver a consultar
    </button>
  );
}

/** Avance mientras Athena trabaja, y el error con su botón de reintentar. */
export function ProgresoConsulta({ fase, onReintentar }: { fase: Fase; onReintentar: () => void }) {
  const [ahora, setAhora] = useState(() => Date.now());

  // Reloj para los segundos de espera.
  useEffect(() => {
    if (fase.tipo !== "esperando") return;
    const t = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [fase.tipo]);

  if (fase.tipo === "listo" || fase.tipo === "quieto") return null;

  if (fase.tipo === "error") {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-start justify-between gap-3 rounded-[4px] bg-[var(--color-alerta-fondo)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-alerta)]"
      >
        <span className="flex items-start gap-2">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
          {fase.mensaje}
        </span>
        <button
          type="button"
          onClick={onReintentar}
          className="rounded-[4px] border border-current px-2.5 py-1 text-xs font-medium"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <section
      aria-busy
      className="rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)] px-5 py-6"
    >
      <p className="cifras flex items-center gap-2 text-[13px] text-[var(--color-tinta)]">
        <Loader2 size={15} className="animate-spin" aria-hidden />
        {fase.tipo === "lanzando" && "Enviando la consulta…"}
        {fase.tipo === "esperando" &&
          `${fase.estado === "QUEUED" ? "En cola" : "Ejecutando la consulta"}… ${Math.max(0, Math.round((ahora - fase.desde) / 1000))} s`}
        {fase.tipo === "leyendo" &&
          (fase.leidas === 0
            ? "Trayendo los resultados…"
            : `Trayendo los resultados… ${cifra(fase.leidas)} filas`)}
      </p>
      <p className="mt-1.5 text-xs text-[var(--color-tinta-suave)]">
        Suele tardar entre unos segundos y un par de minutos.
      </p>
    </section>
  );
}
