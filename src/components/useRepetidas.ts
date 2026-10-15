"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FilaImagen } from "@/lib/imagenesAuditoria";
import {
  PARECIDO,
  agruparRepetidas,
  claveDe,
  clavePar,
  type Grupo,
  type InfoHuella,
  type Parecido,
  type Veredicto,
} from "@/lib/repetidas";

/**
 * Buscar fotos repetidas en las visitas de la galería (las de las fechas
 * elegidas) y confirmarlas con IA. Ver lib/repetidas.ts y la ruta
 * /api/admin/fotos-repetidas.
 *
 * Las huellas y lo que dijo la IA quedan en memoria mientras la página esté
 * abierta (y guardados en la base): volver a buscar con otras fechas solo
 * descarga las fotos que faltan.
 */

const RUTA = "/api/admin/fotos-repetidas";
/** Fotos por llamada al servidor, y cuántas llamadas a la vez. */
const POR_LOTE = 12;
const A_LA_VEZ = 3;
const POR_CONSULTA = 1000;
/** La IA compara la referencia con hasta cinco fotos por llamada. */
const POR_PREGUNTA = 5;

export type EstadoBusqueda =
  | { tipo: "quieto" }
  | { tipo: "buscando"; hechas: number; total: number }
  | { tipo: "error"; mensaje: string };

/** El mismo enlace en dos visitas: no hace falta preguntarle a la IA. */
const MISMO_ENLACE: Veredicto = { misma: true, motivo: "Es el mismo enlace de foto.", ia: "" };

async function pedir<T>(cuerpo: Record<string, unknown>): Promise<T> {
  let r: Response;
  try {
    r = await fetch(RUTA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    throw new Error("Se perdió la conexión con el servidor.");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "No se pudo completar.");
  return j as T;
}

const trozos = <T,>(lista: T[], n: number) =>
  Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n));

/** Cuántas fotos del grupo (sin la primera) ya tienen veredicto, cuántas son la misma y cuántas por tener el mismo enlace. */
export type ResumenIA = { revisadas: number; mismas: number; enlaces: number; total: number };

export function useRepetidas<F extends FilaImagen>(activo: boolean, visitas: F[]) {
  const [huellas, setHuellas] = useState<Map<string, InfoHuella>>(() => new Map());
  const [estado, setEstado] = useState<EstadoBusqueda>({ tipo: "quieto" });
  const [buscado, setBuscado] = useState(false);
  const [parecido, setParecido] = useState<Parecido>("casi");
  const [aviso, setAviso] = useState<string | null>(null);
  const [veredictos, setVeredictos] = useState<Map<string, Veredicto>>(() => new Map());
  const [confirmando, setConfirmando] = useState<{ hechos: number; total: number } | null>(null);
  const [errorIA, setErrorIA] = useState<string | null>(null);
  const vuelta = useRef(0);
  const vueltaIA = useRef(0);
  const pedidos = useRef(new Set<string>());

  /** Las fotos de las visitas, una vez por enlace. */
  const fotos = useMemo(() => {
    const m = new Map<string, string>();
    if (activo) for (const f of visitas) for (const url of f.fotos) m.set(claveDe(url), url);
    return m;
  }, [activo, visitas]);

  const cuentas = useMemo(() => {
    let sinRevisar = 0;
    let conError = 0;
    for (const c of fotos.keys()) {
      const h = huellas.get(c);
      if (!h) sinRevisar++;
      else if (h.error) conError++;
    }
    return { sinRevisar, conError };
  }, [fotos, huellas]);

  const buscando = estado.tipo === "buscando";

  // Mientras se buscan no se agrupa: rehacer los grupos con cada lote solo pone lenta la página.
  const grupos = useMemo(
    () => (activo && buscado && !buscando ? agruparRepetidas(visitas, huellas, PARECIDO[parecido].bits) : []),
    [activo, buscado, buscando, visitas, huellas, parecido]
  );

  const grupoDe = useMemo(() => {
    const m = new Map<F, Grupo<F>>();
    for (const g of grupos) for (const f of g.visitas) m.set(f, g);
    return m;
  }, [grupos]);

  /** Lo que dijo la IA de esa visita frente a la primera del grupo. */
  const veredictoDe = useCallback(
    (g: Grupo<F>, f: F): Veredicto | null => {
      if (f === g.visitas[0]) return null;
      const a = claveDe(g.foto.get(g.visitas[0])!);
      const b = claveDe(g.foto.get(f)!);
      if (a === b) return MISMO_ENLACE;
      return veredictos.get(clavePar(a, b)) ?? null;
    },
    [veredictos]
  );

  const resumenIA = useCallback(
    (g: Grupo<F>): ResumenIA => {
      let revisadas = 0;
      let mismas = 0;
      let enlaces = 0;
      for (const f of g.visitas.slice(1)) {
        const v = veredictoDe(g, f);
        if (!v) continue;
        revisadas++;
        if (v.misma) mismas++;
        if (v === MISMO_ENLACE) enlaces++;
      }
      return { revisadas, mismas, enlaces, total: g.visitas.length - 1 };
    },
    [veredictoDe]
  );

  // Lo que la IA ya dijo antes (guardado en la base) se trae solo, sin volver a preguntar.
  useEffect(() => {
    if (grupos.length === 0) return;
    const pares: string[] = [];
    for (const g of grupos) {
      const ref = claveDe(g.foto.get(g.visitas[0])!);
      for (const f of g.visitas.slice(1)) {
        const otra = claveDe(g.foto.get(f)!);
        if (otra === ref) continue;
        const par = clavePar(ref, otra);
        if (!pedidos.current.has(par)) {
          pedidos.current.add(par);
          pares.push(par);
        }
      }
    }
    if (pares.length === 0) return;
    (async () => {
      for (const lote of trozos(pares, POR_CONSULTA)) {
        const j = await pedir<{ veredictos: Record<string, Veredicto> }>({ accion: "veredictos", pares: lote });
        const nuevos = Object.entries(j.veredictos ?? {});
        if (nuevos.length) setVeredictos((m) => new Map([...m, ...nuevos]));
      }
    })().catch(() => {
      // Si no se pueden leer, se pueden volver a confirmar: no vale la pena avisar.
    });
  }, [grupos]);

  // ------------------------------------------------------------ buscar
  async function buscar() {
    const id = ++vuelta.current;
    const vigente = () => vuelta.current === id;
    setAviso(null);
    setBuscado(true);

    const claves = [...fotos.keys()].filter((c) => !huellas.has(c));
    const total = claves.length;
    let hechas = 0;
    setEstado({ tipo: "buscando", hechas, total });

    const nuevas = new Map<string, InfoHuella>();
    const volcar = () => {
      if (nuevas.size === 0) return;
      const copia = [...nuevas];
      nuevas.clear();
      setHuellas((m) => new Map([...m, ...copia]));
    };

    try {
      // 1. Las que ya tienen huella guardada.
      const faltan: string[] = [];
      for (const lote of trozos(claves, POR_CONSULTA)) {
        const j = await pedir<{ huellas: Record<string, InfoHuella>; aviso: string | null }>({ accion: "guardadas", claves: lote });
        if (!vigente()) return;
        if (j.aviso) setAviso(j.aviso);
        for (const c of lote) {
          if (j.huellas[c]) {
            nuevas.set(c, j.huellas[c]);
            hechas++;
          } else faltan.push(c);
        }
        volcar();
        setEstado({ tipo: "buscando", hechas, total });
      }

      // 2. Las demás: el servidor las descarga y les saca la huella.
      const lotes = trozos(faltan, POR_LOTE);
      let siguiente = 0;
      await Promise.all(
        Array.from({ length: Math.min(A_LA_VEZ, lotes.length) }, async () => {
          while (siguiente < lotes.length && vigente()) {
            const lote = lotes[siguiente++];
            const urls = lote.map((c) => fotos.get(c)!);
            let j: { huellas: Record<string, InfoHuella>; aviso: string | null };
            try {
              j = await pedir({ accion: "sacar", urls });
            } catch {
              j = await pedir({ accion: "sacar", urls }); // un segundo intento antes de rendirse
            }
            if (!vigente()) return;
            if (j.aviso) setAviso(j.aviso);
            for (const [c, info] of Object.entries(j.huellas)) nuevas.set(c, info);
            hechas += lote.length;
            volcar();
            setEstado({ tipo: "buscando", hechas, total });
          }
        })
      );
      if (vigente()) setEstado({ tipo: "quieto" });
    } catch (e) {
      if (!vigente()) return;
      volcar();
      setEstado({ tipo: "error", mensaje: (e as Error).message });
    }
  }

  function detener() {
    vuelta.current++;
    setEstado({ tipo: "quieto" });
  }

  // ------------------------------------------------------------ IA
  /** Los grupos que todavía tienen fotos sin confirmar con IA. */
  const pendientesIA = useMemo(
    () => grupos.filter((g) => g.visitas.slice(1).some((f) => !veredictoDe(g, f))),
    [grupos, veredictoDe]
  );

  async function confirmar(lista: Grupo<F>[]) {
    setErrorIA(null);
    const trabajos: { referencia: string; otras: string[] }[] = [];
    for (const g of lista) {
      const referencia = g.foto.get(g.visitas[0])!;
      const otras = [
        ...new Set(
          g.visitas
            .slice(1)
            .filter((f) => !veredictoDe(g, f))
            .map((f) => g.foto.get(f)!)
        ),
      ];
      for (const lote of trozos(otras, POR_PREGUNTA)) trabajos.push({ referencia, otras: lote });
    }
    if (trabajos.length === 0) return;

    const id = ++vueltaIA.current;
    setConfirmando({ hechos: 0, total: trabajos.length });
    for (let i = 0; i < trabajos.length; i++) {
      if (vueltaIA.current !== id) return;
      try {
        const j = await pedir<{ veredictos: Record<string, Veredicto>; fallidas: Record<string, string> }>({
          accion: "confirmar",
          ...trabajos[i],
        });
        const nuevos = Object.entries(j.veredictos ?? {});
        if (nuevos.length) setVeredictos((m) => new Map([...m, ...nuevos]));
        const fallidas = Object.keys(j.fallidas ?? {}).length;
        if (fallidas) setErrorIA(`${fallidas === 1 ? "Una foto no se pudo" : `${fallidas} fotos no se pudieron`} descargar para la IA.`);
      } catch (e) {
        if (vueltaIA.current === id) {
          setErrorIA((e as Error).message);
          setConfirmando(null);
        }
        return;
      }
      if (vueltaIA.current === id) setConfirmando({ hechos: i + 1, total: trabajos.length });
    }
    if (vueltaIA.current === id) setConfirmando(null);
  }

  function detenerIA() {
    vueltaIA.current++;
    setConfirmando(null);
  }

  /** Otra consulta: se olvidan los grupos, no las huellas ni lo que dijo la IA. */
  const reiniciar = useCallback(() => {
    vuelta.current++;
    vueltaIA.current++;
    setBuscado(false);
    setEstado({ tipo: "quieto" });
    setConfirmando(null);
    setErrorIA(null);
    setAviso(null);
  }, []);

  return {
    activo,
    estado,
    buscado,
    aviso,
    total: fotos.size,
    ...cuentas,
    parecido,
    setParecido,
    grupos,
    grupoDe,
    veredictoDe,
    resumenIA,
    pendientesIA,
    confirmando,
    errorIA,
    buscar,
    detener,
    confirmar,
    detenerIA,
    reiniciar,
  };
}

export type Repetidas<F extends FilaImagen> = ReturnType<typeof useRepetidas<F>>;
