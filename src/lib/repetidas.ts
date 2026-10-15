/**
 * Fotos repetidas: la misma foto usada en visitas distintas. Tipos, distancia
 * entre huellas y armado de los grupos. Lo usan el navegador y la ruta
 * /api/admin/fotos-repetidas; aquí no se importa nada del servidor.
 *
 * La huella de cada foto (lib/huellaVisual.ts) la saca el servidor una vez y
 * queda guardada (tabla huellas_fotos). Los grupos se arman en el navegador:
 * dos visitas quedan juntas si alguna foto de una se parece a alguna de la
 * otra, y los parecidos se encadenan (si A se parece a B y B a C, van las tres).
 */
import { huella as claveDe, PATRON_CLAVE } from "./revisionFotos";
import type { FilaImagen } from "./imagenesAuditoria";

export { claveDe, PATRON_CLAVE };

export type InfoHuella = {
  huella: string | null;
  plana: boolean;
  error: string | null;
};

export type Veredicto = {
  misma: boolean;
  motivo: string;
  ia: string;
};

/** Cuántos bits distintos (de 64) se aceptan para decir que dos fotos son la misma. */
export const PARECIDO = {
  identicas: { nombre: "Idénticas", bits: 4 },
  casi: { nombre: "Casi iguales", bits: 10 },
  parecidas: { nombre: "Parecidas", bits: 14 },
} as const;
export type Parecido = keyof typeof PARECIDO;

export const PATRON_HUELLA = /^[0-9a-f]{16}$/;

/** El par de fotos, en el mismo orden siempre: así se guarda lo que dijo la IA. */
export function clavePar(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function bits(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/** Bits distintos entre dos huellas. */
export function distancia(a: string, b: string): number {
  return (
    bits((parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)) >>> 0) +
    bits((parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16)) >>> 0)
  );
}

export type Grupo<F extends FilaImagen> = {
  numero: number;
  /** De la más antigua a la más reciente: la primera es la referencia. */
  visitas: F[];
  /** La foto de cada visita que se parece a otra del grupo. */
  foto: Map<F, string>;
  pdvs: number;
  consultores: number;
};

/**
 * Los grupos de visitas con fotos repetidas, del más grande al más chico.
 * No se comparan las fotos de una misma visita entre sí, ni las fotos planas
 * (negras o en blanco), que se parecen todas.
 */
export function agruparRepetidas<F extends FilaImagen>(
  visitas: F[],
  huellas: Map<string, InfoHuella>,
  maxBits: number
): Grupo<F>[] {
  type Foto = { v: number; url: string; alta: number; baja: number };
  const fotos: Foto[] = [];
  visitas.forEach((f, v) => {
    for (const url of f.fotos) {
      const h = huellas.get(claveDe(url));
      if (!h?.huella || h.plana) continue;
      fotos.push({ v, url, alta: parseInt(h.huella.slice(0, 8), 16), baja: parseInt(h.huella.slice(8), 16) });
    }
  });

  const padre = visitas.map((_, i) => i);
  const raiz = (i: number): number => {
    while (padre[i] !== i) {
      padre[i] = padre[padre[i]];
      i = padre[i];
    }
    return i;
  };
  const foto = new Map<number, string>();

  for (let i = 0; i < fotos.length; i++) {
    const a = fotos[i];
    for (let j = i + 1; j < fotos.length; j++) {
      const b = fotos[j];
      if (a.v === b.v) continue;
      if (bits((a.alta ^ b.alta) >>> 0) + bits((a.baja ^ b.baja) >>> 0) > maxBits) continue;
      if (!foto.has(a.v)) foto.set(a.v, a.url);
      if (!foto.has(b.v)) foto.set(b.v, b.url);
      const ra = raiz(a.v);
      const rb = raiz(b.v);
      if (ra !== rb) padre[ra] = rb;
    }
  }

  const porRaiz = new Map<number, number[]>();
  for (const v of foto.keys()) {
    const r = raiz(v);
    (porRaiz.get(r) ?? porRaiz.set(r, []).get(r)!).push(v);
  }

  const grupos = [...porRaiz.values()]
    .filter((vs) => vs.length > 1)
    .map((vs) => {
      const ordenadas = vs.map((v) => visitas[v]).sort((a, b) => (a.orden === b.orden ? 0 : !a.orden ? 1 : !b.orden ? -1 : a.orden < b.orden ? -1 : 1));
      return {
        visitas: ordenadas,
        foto: new Map(vs.map((v) => [visitas[v], foto.get(v)!])),
        pdvs: new Set(ordenadas.map((f) => (f.cod_personalizado ?? f.nombre_pdv ?? "").trim())).size,
        consultores: new Set(ordenadas.map((f) => (f.nombre_usuario ?? "").trim())).size,
      };
    })
    .sort((a, b) => b.visitas.length - a.visitas.length || (a.visitas[0].orden < b.visitas[0].orden ? 1 : -1));

  return grupos.map((g, i) => ({ ...g, numero: i + 1 }));
}
