/**
 * Fotos repetidas: la misma foto usada en visitas distintas. Tipos, distancia
 * entre huellas y armado de los grupos. Lo usan el navegador y la ruta
 * /api/admin/fotos-repetidas; aquí no se importa nada del servidor.
 *
 * La huella de cada foto (lib/huellaVisual.ts) la saca el servidor una vez y
 * queda guardada (tabla huellas_fotos). Los grupos se arman en el navegador
 * (agruparRepetidas, abajo).
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
  casi: { nombre: "Casi iguales", bits: 8 },
  parecidas: { nombre: "Parecidas", bits: 12 },
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

/** De la más antigua a la más reciente; las que no traen fecha, al final. */
const porFecha = (a: FilaImagen, b: FilaImagen) =>
  a.orden === b.orden ? 0 : !a.orden ? 1 : !b.orden ? -1 : a.orden < b.orden ? -1 : 1;

/**
 * Los grupos de visitas con fotos repetidas, del más grande al más chico.
 *
 * Cada grupo es una foto y sus copias directas: se toma la visita más
 * antigua, se le juntan las que tienen una foto parecida a la suya, y esas ya
 * no entran en otro grupo. No se encadena (si A se parece a B y B a C, pero A
 * no a C, C no entra con A): con fotos de un mismo objeto, como el libro que
 * se entrega en todos los PDV, encadenar armaba grupos de cientos de visitas
 * que no eran copias entre sí.
 *
 * No se comparan las fotos de una misma visita entre sí, ni las fotos planas
 * (negras o en blanco), que se parecen todas.
 */
export function agruparRepetidas<F extends FilaImagen>(
  visitas: F[],
  huellas: Map<string, InfoHuella>,
  maxBits: number
): Grupo<F>[] {
  type Foto = { url: string; alta: number; baja: number };
  const orden = [...visitas].sort(porFecha);
  const fotosDe = orden.map((f) => {
    const salida: Foto[] = [];
    for (const url of f.fotos) {
      const h = huellas.get(claveDe(url));
      if (!h?.huella || h.plana) continue;
      salida.push({ url, alta: parseInt(h.huella.slice(0, 8), 16), baja: parseInt(h.huella.slice(8), 16) });
    }
    return salida;
  });
  const parecidas = (a: Foto, b: Foto) => bits((a.alta ^ b.alta) >>> 0) + bits((a.baja ^ b.baja) >>> 0) <= maxBits;

  const usada = new Array<boolean>(orden.length).fill(false);
  const grupos: Omit<Grupo<F>, "numero">[] = [];
  for (let i = 0; i < orden.length; i++) {
    if (usada[i] || fotosDe[i].length === 0) continue;
    const foto = new Map<F, string>();
    for (let j = i + 1; j < orden.length; j++) {
      if (usada[j]) continue;
      buscar: for (const a of fotosDe[i]) {
        for (const b of fotosDe[j]) {
          if (!parecidas(a, b)) continue;
          if (!foto.has(orden[i])) foto.set(orden[i], a.url);
          foto.set(orden[j], b.url);
          usada[j] = true;
          break buscar;
        }
      }
    }
    if (foto.size === 0) continue;
    usada[i] = true;
    const integrantes = orden.filter((f) => foto.has(f));
    grupos.push({
      visitas: integrantes,
      foto,
      pdvs: new Set(integrantes.map((f) => (f.cod_personalizado ?? f.nombre_pdv ?? "").trim())).size,
      consultores: new Set(integrantes.map((f) => (f.nombre_usuario ?? "").trim())).size,
    });
  }

  grupos.sort((a, b) => b.visitas.length - a.visitas.length || porFecha(b.visitas[0], a.visitas[0]));
  return grupos.map((g, i) => ({ ...g, numero: i + 1 }));
}
