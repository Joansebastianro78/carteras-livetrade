"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FilaImagen } from "@/lib/imagenesAuditoria";
import { claveDe } from "@/lib/repetidas";
import {
  ETIQUETAS_POR_DEFECTO,
  FOTOS_POR_PREGUNTA,
  ILEGIBLE,
  leerEtiquetas,
  type Vistas,
} from "@/lib/etiquetasIA";

/**
 * Qué se ve en las fotos, según la IA. Se escribe qué buscar (libro, afiche…),
 * se le muestran a la IA las fotos de las visitas filtradas de a diez, y la
 * galería filtra por lo que vio. Lo que dijo queda guardado en la base (ruta
 * /api/admin/fotos-ia): volver a revisar solo pregunta por lo que falta.
 */

const RUTA = "/api/admin/fotos-ia";
const RECORDAR = "auditoria-query:etiquetas";
const A_LA_VEZ = 2;
const POR_CONSULTA = 1000;
/** Si la IA pide esperar más que esto, se para y se avisa en vez de esperar. */
const ESPERA_MAXIMA = 150;

export type EstadoEtiquetas =
  | { tipo: "quieto" }
  | { tipo: "revisando"; hechas: number; total: number; esperando: number | null }
  | { tipo: "error"; mensaje: string };

/** Lo que la IA vio en una visita, con las etiquetas de ahora. */
export type Visto = { revisada: boolean; ve: string[]; ilegible: boolean };

class ErrorEspera extends Error {
  constructor(mensaje: string, readonly segundos: number) {
    super(mensaje);
  }
}

async function pedir<T>(cuerpo: Record<string, unknown>): Promise<T> {
  let r: Response;
  try {
    r = await fetch(RUTA, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  } catch {
    throw new Error("Se perdió la conexión con el servidor.");
  }
  const j = await r.json().catch(() => ({}));
  if (r.status === 429 && Number(j.esperarSegundos) > 0) throw new ErrorEspera(j.error ?? "Hay que esperar.", Number(j.esperarSegundos));
  if (!r.ok) throw new Error(j.error ?? "No se pudo completar.");
  return j as T;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trozos = <T,>(lista: T[], n: number) =>
  Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n));

function leerRecordadas(): string {
  try {
    return window.localStorage.getItem(RECORDAR) ?? ETIQUETAS_POR_DEFECTO;
  } catch {
    return ETIQUETAS_POR_DEFECTO;
  }
}

export function useEtiquetasIA(activo: boolean) {
  const [texto, setTextoEstado] = useState(ETIQUETAS_POR_DEFECTO);
  const [resultados, setResultados] = useState<Map<string, Vistas>>(() => new Map());
  const [fallidas, setFallidas] = useState<Set<string>>(() => new Set());
  const [estado, setEstado] = useState<EstadoEtiquetas>({ tipo: "quieto" });
  const [aviso, setAviso] = useState<string | null>(null);
  const vuelta = useRef(0);

  const etiquetas = useMemo(() => leerEtiquetas(texto), [texto]);

  // Lo que se escribió la última vez, en este navegador (después de pintar, para no chocar con el servidor).
  useEffect(() => {
    if (activo) setTextoEstado(leerRecordadas());
  }, [activo]);

  const setTexto = useCallback((t: string) => {
    setTextoEstado(t);
    try {
      window.localStorage.setItem(RECORDAR, t);
    } catch {
      // Sin almacenamiento solo se pierde recordar lo que se escribió.
    }
  }, []);

  /** Si ya se sabe qué tiene esa foto con las etiquetas de ahora (o no se pudo descargar). */
  const fotoLista = useCallback(
    (url: string) => {
      const c = claveDe(url);
      if (fallidas.has(c)) return true;
      const v = resultados.get(c);
      return Boolean(v) && etiquetas.every((e) => e in v!);
    },
    [resultados, fallidas, etiquetas]
  );

  const vistoDe = useCallback(
    (f: FilaImagen): Visto | null => {
      if (!activo || f.fotos.length === 0 || etiquetas.length === 0) return null;
      const ve = new Set<string>();
      let revisadas = 0;
      let ilegibles = 0;
      for (const url of f.fotos) {
        const v = resultados.get(claveDe(url));
        if (!v || !etiquetas.every((e) => e in v)) continue;
        revisadas++;
        if (v[ILEGIBLE]) ilegibles++;
        for (const e of etiquetas) if (v[e]) ve.add(e);
      }
      const revisada = f.fotos.every(fotoLista) && revisadas > 0;
      return { revisada, ve: etiquetas.filter((e) => ve.has(e)), ilegible: revisadas > 0 && ilegibles === revisadas };
    },
    [activo, etiquetas, resultados, fotoLista]
  );

  /** Cuántas fotos de esas visitas faltan por revisar con las etiquetas de ahora. */
  const pendientesDe = useCallback(
    (visitas: FilaImagen[]) => {
      const vistas = new Set<string>();
      for (const f of visitas) for (const url of f.fotos) if (!fotoLista(url)) vistas.add(url);
      return [...vistas];
    },
    [fotoLista]
  );

  async function revisar(visitas: FilaImagen[]) {
    if (etiquetas.length === 0) return;
    const id = ++vuelta.current;
    const vigente = () => vuelta.current === id;
    setAviso(null);
    const lista = etiquetas;
    let urls = pendientesDe(visitas);
    const total = urls.length;
    let hechas = 0;
    setEstado({ tipo: "revisando", hechas, total, esperando: null });

    const juntar = (nuevos: Record<string, Vistas>) =>
      setResultados((m) => {
        const n = new Map(m);
        for (const [c, v] of Object.entries(nuevos)) n.set(c, { ...(n.get(c) ?? {}), ...v });
        return n;
      });

    try {
      // 1. Lo que la IA ya dijo antes (guardado en la base).
      const yaDichas = new Set<string>();
      for (const lote of trozos(urls, POR_CONSULTA)) {
        const j = await pedir<{ resultados: Record<string, Vistas>; aviso: string | null }>({
          accion: "guardadas",
          claves: lote.map(claveDe),
          etiquetas: lista,
        });
        if (!vigente()) return;
        if (j.aviso) setAviso(j.aviso);
        juntar(j.resultados);
        for (const [c, v] of Object.entries(j.resultados)) if (lista.every((e) => e in v)) yaDichas.add(c);
      }
      urls = urls.filter((u) => !yaDichas.has(claveDe(u)));
      hechas = total - urls.length;
      setEstado({ tipo: "revisando", hechas, total, esperando: null });

      // 2. Las demás, de a diez por pregunta.
      const lotes = trozos(urls, FOTOS_POR_PREGUNTA);
      let siguiente = 0;
      await Promise.all(
        Array.from({ length: Math.min(A_LA_VEZ, lotes.length) }, async () => {
          while (siguiente < lotes.length && vigente()) {
            const lote = lotes[siguiente++];
            let intentos = 0;
            for (;;) {
              try {
                const j = await pedir<{ resultados: Record<string, Vistas>; fallidas: Record<string, string>; aviso: string | null }>({
                  accion: "revisar",
                  urls: lote,
                  etiquetas: lista,
                });
                if (!vigente()) return;
                if (j.aviso) setAviso(j.aviso);
                juntar(j.resultados);
                const malas = Object.keys(j.fallidas ?? {}).map(claveDe);
                if (malas.length) setFallidas((s) => new Set([...s, ...malas]));
                break;
              } catch (e) {
                if (!vigente()) return;
                if (e instanceof ErrorEspera && e.segundos <= ESPERA_MAXIMA) {
                  // Tope por minuto de Gemini: se espera y se sigue solo.
                  setEstado({ tipo: "revisando", hechas, total, esperando: e.segundos });
                  await esperar(e.segundos * 1000);
                  if (!vigente()) return;
                  setEstado({ tipo: "revisando", hechas, total, esperando: null });
                  continue;
                }
                if (!(e instanceof ErrorEspera) && ++intentos < 2) continue;
                throw e;
              }
            }
            hechas += lote.length;
            setEstado({ tipo: "revisando", hechas, total, esperando: null });
          }
        })
      );
      if (vigente()) setEstado({ tipo: "quieto" });
    } catch (e) {
      if (!vigente()) return;
      setEstado({ tipo: "error", mensaje: (e as Error).message });
    }
  }

  function detener() {
    vuelta.current++;
    setEstado({ tipo: "quieto" });
  }

  return { activo, texto, setTexto, etiquetas, estado, aviso, vistoDe, pendientesDe, revisar, detener };
}

export type EtiquetasIA = ReturnType<typeof useEtiquetasIA>;
