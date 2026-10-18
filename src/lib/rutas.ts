/**
 * Generador de rutas: reparte puntos entre personas por cercanía.
 *
 * Es cluster_rutas.py pasado a TypeScript, paso por paso, para que corra en el
 * navegador (el Excel no sale del computador de quien lo usa):
 *
 *   1. Corrige las coordenadas: coma decimal, signo de la longitud perdido,
 *      latitud y longitud invertidas y números sin punto decimal.
 *   2. Agrupa con k-means++ y, en cada vuelta, asigna con capacidad: cada ruta
 *      recibe entre `minimo` y `cap` puntos con la menor distancia total.
 *      Es la misma asignación óptima que hace linear_sum_assignment en el
 *      script, resuelta como flujo de costo mínimo (más rápido en el
 *      navegador; da el mismo costo total).
 *   3. Numera las rutas de norte a sur (y de oeste a este si empatan) y arma
 *      el resumen por ruta.
 *
 * Sin DOM ni Excel aquí: lo usan el worker (rutas.worker.ts) y las pruebas.
 */

// ---------------------------------------------------------------- constantes
export const SIN_ASIGNAR = "SIN ASIGNAR";
export const SIN_COORD = "SIN COORDENADAS";

/** Límites aproximados de Colombia (incluye San Andrés). */
const LAT_MIN = -4.3;
const LAT_MAX = 13.6;
const LON_MIN = -82.0;
const LON_MAX = -66.8;

// ---------------------------------------------------------------- utilidades
/** Mayúsculas, sin tildes, guion bajo como espacio y espacios simples. */
export function normalizar(texto: unknown): string {
  if (texto === null || texto === undefined) return "";
  return String(texto)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

const NUMERO = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Un número de una celda: acepta coma decimal y "4.540.0957" (se le quitan los puntos). */
export function aNumero(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  let f: number;
  if (typeof v === "number") f = v;
  else if (typeof v === "boolean") f = v ? 1 : 0;
  else {
    let s = String(v).trim().replace(/ /g, "").replace(/,/g, ".");
    if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
    if (!NUMERO.test(s)) return null;
    f = Number(s);
  }
  return Number.isFinite(f) ? f : null;
}

function mediana(valores: number[]): number {
  const v = [...valores].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// ---------------------------------------------------------------- coordenadas
/**
 * Devuelve latitudes y longitudes corregidas (null si no se pudo). Corrige
 * coma decimal, signo de longitud perdido, lat/lon invertidas y números sin
 * punto decimal (45400957 → 4.5400957), eligiendo la escala más cercana a la
 * mediana de los puntos que ya están bien.
 */
export function corregirCoordenadas(latCrudas: unknown[], lonCrudas: unknown[]): { lat: (number | null)[]; lon: (number | null)[] } {
  const lat = latCrudas.map(aNumero);
  const lon = lonCrudas.map(aNumero);
  const enRango = (a: number | null, b: number | null) =>
    a !== null && b !== null && LAT_MIN <= a && a <= LAT_MAX && LON_MIN <= b && b <= LON_MAX;

  // signo y orden
  for (let i = 0; i < lat.length; i++) {
    let a = lat[i];
    let b = lon[i];
    if (a === null || b === null) continue;
    if (b > 0 && -LON_MAX <= b && b <= -LON_MIN) b = -b;
    if (!enRango(a, b) && enRango(b, a)) [a, b] = [b, a];
    lat[i] = a;
    lon[i] = b;
  }

  const buenos = lat.map((_, i) => i).filter((i) => enRango(lat[i], lon[i]));
  const medLat = buenos.length ? mediana(buenos.map((i) => lat[i]!)) : 4.65;
  const medLon = buenos.length ? mediana(buenos.map((i) => lon[i]!)) : -74.1;

  const escalar = (v: number | null, lo: number, hi: number, med: number): number | null => {
    if (v === null) return null;
    if (lo <= v && v <= hi) return v;
    let mejor: number | null = null;
    for (let k = 1; k <= 12; k++) {
      const w = v / 10 ** k;
      if (lo <= w && w <= hi && (mejor === null || Math.abs(w - med) < Math.abs(mejor - med))) mejor = w;
    }
    return mejor;
  };

  for (let i = 0; i < lat.length; i++) {
    if (enRango(lat[i], lon[i])) continue;
    lat[i] = escalar(lat[i], LAT_MIN, LAT_MAX, medLat);
    lon[i] = escalar(lon[i], LON_MIN, LON_MAX, medLon);
    if (!enRango(lat[i], lon[i])) lat[i] = lon[i] = null;
  }
  return { lat, lon };
}

/** Coordenadas planas en km alrededor del centro de los puntos (x, y intercalados). */
export function aKilometros(lat: number[], lon: number[]): Float64Array {
  const n = lat.length;
  const mLat = lat.reduce((a, b) => a + b, 0) / n;
  const mLon = lon.reduce((a, b) => a + b, 0) / n;
  const c = Math.cos((mLat * Math.PI) / 180);
  const X = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    X[2 * i] = (lon[i] - mLon) * 111.32 * c;
    X[2 * i + 1] = (lat[i] - mLat) * 110.574;
  }
  return X;
}

// ---------------------------------------------------------------- azar
/** Números al azar repetibles con una semilla (mulberry32). */
export function crearAzar(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- k-means++
function kmeansPP(X: Float64Array, n: number, k: number, azar: () => number): Float64Array {
  const centros = new Float64Array(k * 2);
  const primero = Math.floor(azar() * n);
  centros[0] = X[2 * primero];
  centros[1] = X[2 * primero + 1];
  const d2 = new Float64Array(n);
  for (let i = 0; i < n; i++) d2[i] = (X[2 * i] - centros[0]) ** 2 + (X[2 * i + 1] - centros[1]) ** 2;
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < n; i++) total += d2[i];
    let elegido = -1;
    if (total > 0) {
      let r = azar() * total;
      for (let i = 0; i < n; i++) {
        if (d2[i] <= 0) continue;
        elegido = i; // si el redondeo deja r ≥ 0 al final, queda el último posible
        r -= d2[i];
        if (r < 0) break;
      }
    } else {
      elegido = Math.floor(azar() * n);
    }
    centros[2 * c] = X[2 * elegido];
    centros[2 * c + 1] = X[2 * elegido + 1];
    for (let i = 0; i < n; i++) {
      const d = (X[2 * i] - centros[2 * c]) ** 2 + (X[2 * i + 1] - centros[2 * c + 1]) ** 2;
      if (d < d2[i]) d2[i] = d;
    }
  }
  return centros;
}

// ---------------------------------------------------------------- montículo
/** Montículo de mínimos con valores numéricos y un id por entrada. */
class Monticulo {
  claves = new Float64Array(16);
  ids = new Int32Array(16);
  largo = 0;

  agregar(clave: number, id: number) {
    if (this.largo === this.claves.length) {
      const c = new Float64Array(this.largo * 2);
      c.set(this.claves);
      this.claves = c;
      const d = new Int32Array(this.largo * 2);
      d.set(this.ids);
      this.ids = d;
    }
    let i = this.largo++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.claves[p] <= clave) break;
      this.claves[i] = this.claves[p];
      this.ids[i] = this.ids[p];
      i = p;
    }
    this.claves[i] = clave;
    this.ids[i] = id;
  }

  quitar() {
    const n = --this.largo;
    if (n <= 0) return;
    const clave = this.claves[n];
    const id = this.ids[n];
    let i = 0;
    for (;;) {
      let h = 2 * i + 1;
      if (h >= n) break;
      if (h + 1 < n && this.claves[h + 1] < this.claves[h]) h++;
      if (this.claves[h] >= clave) break;
      this.claves[i] = this.claves[h];
      this.ids[i] = this.ids[h];
      i = h;
    }
    this.claves[i] = clave;
    this.ids[i] = id;
  }
}

// ---------------------------------------------------------------- asignación
/**
 * Cada ruta recibe entre `minimo` y `cap` puntos minimizando la suma de
 * distancias al cuadrado a su centro. Si hay más puntos que cupos (k·cap),
 * quedan por fuera (-1) los que más costaría meter en alguna ruta.
 *
 * Igual que el script: allá es linear_sum_assignment sobre una matriz de
 * puntos × cupos con un premio grande para llenar primero los cupos mínimos.
 * Aquí es el mismo problema como flujo de costo mínimo (caminos más cortos
 * sucesivos con potenciales), donde los puntos solo se recorren entre rutas:
 * el grafo de Dijkstra tiene k + 2 nodos. El costo va en dos partes que se
 * comparan en orden: primero cuántos cupos mínimos se llenan (el premio),
 * después la distancia. Así no hace falta un número enorme como el del script.
 */
export function asignarConCapacidad(
  X: Float64Array,
  n: number,
  centros: Float64Array,
  k: number,
  cap: number,
  minimo: number
): { etiquetas: Int32Array; objetivo: number } {
  const D = new Float64Array(n * k);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) {
      D[i * k + j] = (X[2 * i] - centros[2 * j]) ** 2 + (X[2 * i + 1] - centros[2 * j + 1]) ** 2;
    }
  }

  const asignado = new Int32Array(n).fill(-1);
  const cuenta = new Int32Array(k);
  // Puntos sin ruta, por distancia a cada ruta.
  const libres: Monticulo[] = Array.from({ length: k }, (_, j) => {
    const m = new Monticulo();
    for (let i = 0; i < n; i++) m.agregar(D[i * k + j], i);
    return m;
  });
  // Puntos de la ruta a, por lo que cuesta pasarlos a la ruta b.
  const cambios: Monticulo[] = Array.from({ length: k * k }, () => new Monticulo());
  const entrar = (q: number, a: number) => {
    asignado[q] = a;
    for (let b = 0; b < k; b++) if (b !== a) cambios[a * k + b].agregar(D[q * k + b] - D[q * k + a], q);
  };

  // Nodos: rutas 0..k-1, S = k (origen), T = k + 1 (destino).
  const S = k;
  const T = k + 1;
  const N = k + 2;
  // Potenciales y distancias en dos partes: (premio, distancia).
  const piA = new Float64Array(N);
  const piB = new Float64Array(N);
  piA[T] = -1; // el arco ruta → destino del cupo mínimo cuesta (-1, 0)
  const dA = new Float64Array(N);
  const dB = new Float64Array(N);
  const visto = new Uint8Array(N);
  const padre = new Int32Array(N);
  const via = new Int32Array(N); // el punto por el que se llega a esa ruta
  const topeB = new Float64Array(k * k);
  const topeId = new Int32Array(k * k);
  const topeS = new Float64Array(k);
  const topeSId = new Int32Array(k);

  const flujo = Math.min(n, k * cap);
  for (let paso = 0; paso < flujo; paso++) {
    // Lo más barato de cada montículo (quitando lo que ya no vale).
    for (let j = 0; j < k; j++) {
      const m = libres[j];
      while (m.largo > 0 && asignado[m.ids[0]] !== -1) m.quitar();
      topeSId[j] = m.largo > 0 ? m.ids[0] : -1;
      topeS[j] = m.largo > 0 ? m.claves[0] : Infinity;
    }
    for (let a = 0; a < k; a++) {
      if (cuenta[a] === 0) {
        for (let b = 0; b < k; b++) topeId[a * k + b] = -1;
        continue;
      }
      for (let b = 0; b < k; b++) {
        const e = a * k + b;
        if (a === b) {
          topeId[e] = -1;
          continue;
        }
        const m = cambios[e];
        while (m.largo > 0 && asignado[m.ids[0]] !== a) m.quitar();
        topeId[e] = m.largo > 0 ? m.ids[0] : -1;
        topeB[e] = m.largo > 0 ? m.claves[0] : Infinity;
      }
    }

    // Dijkstra denso con costos reducidos.
    dA.fill(Infinity);
    dB.fill(Infinity);
    visto.fill(0);
    padre.fill(-1);
    dA[S] = 0;
    dB[S] = 0;
    for (;;) {
      let u = -1;
      for (let v = 0; v < N; v++) {
        if (visto[v] || dA[v] === Infinity) continue;
        if (u === -1 || dA[v] < dA[u] || (dA[v] === dA[u] && dB[v] < dB[u])) u = v;
      }
      if (u === -1 || u === T) break;
      visto[u] = 1;
      const relajar = (v: number, wA: number, wB: number, punto: number) => {
        const nA = dA[u] + wA + piA[u] - piA[v];
        const nB = dB[u] + wB + piB[u] - piB[v];
        if (nA < dA[v] || (nA === dA[v] && nB < dB[v])) {
          dA[v] = nA;
          dB[v] = nB;
          padre[v] = u;
          via[v] = punto;
        }
      };
      if (u === S) {
        for (let j = 0; j < k; j++) if (topeSId[j] >= 0 && !visto[j]) relajar(j, 0, topeS[j], topeSId[j]);
      } else {
        for (let b = 0; b < k; b++) {
          const e = u * k + b;
          if (topeId[e] >= 0 && !visto[b]) relajar(b, 0, topeB[e], topeId[e]);
        }
        if (cuenta[u] < cap) relajar(T, cuenta[u] < minimo ? -1 : 0, 0, -1);
      }
    }
    if (dA[T] === Infinity) break; // no debería pasar: siempre queda un cupo

    // Se recorre el camino desde el destino: cada punto pasa de la ruta u a la
    // ruta v (o entra desde los libres si u es el origen).
    let v = padre[T];
    while (v !== S) {
      const u = padre[v];
      cuenta[v]++;
      if (u !== S) cuenta[u]--;
      entrar(via[v], v);
      v = u;
    }

    // Potenciales nuevos: π += min(d, d(T)).
    for (let x = 0; x < N; x++) {
      const menor = dA[x] < dA[T] || (dA[x] === dA[T] && dB[x] < dB[T]);
      piA[x] += menor ? dA[x] : dA[T];
      piB[x] += menor ? dB[x] : dB[T];
    }
  }

  let objetivo = 0;
  for (let i = 0; i < n; i++) if (asignado[i] >= 0) objetivo += D[i * k + asignado[i]];
  return { etiquetas: asignado, objetivo };
}

// ---------------------------------------------------------------- k-means con capacidad
export function kmeansConCapacidad(
  X: Float64Array,
  n: number,
  k: number,
  cap: number,
  minimo: number,
  nInit: number,
  azar: () => number,
  alAvanzar?: (hecho: number) => void,
  maxIter = 60
): Int32Array {
  let mejor: { etiquetas: Int32Array; objetivo: number } | null = null;
  for (let intento = 0; intento < nInit; intento++) {
    const centros = kmeansPP(X, n, k, azar);
    let etiquetas: Int32Array | null = null;
    let objetivo = Infinity;
    for (let it = 0; it < maxIter; it++) {
      const r = asignarConCapacidad(X, n, centros, k, cap, minimo);
      objetivo = r.objetivo;
      if (etiquetas && r.etiquetas.every((e, i) => e === etiquetas![i])) break;
      etiquetas = r.etiquetas;
      const suma = new Float64Array(k * 2);
      const cuantos = new Int32Array(k);
      for (let i = 0; i < n; i++) {
        const j = etiquetas[i];
        if (j < 0) continue;
        suma[2 * j] += X[2 * i];
        suma[2 * j + 1] += X[2 * i + 1];
        cuantos[j]++;
      }
      for (let j = 0; j < k; j++) {
        if (cuantos[j] === 0) continue;
        centros[2 * j] = suma[2 * j] / cuantos[j];
        centros[2 * j + 1] = suma[2 * j + 1] / cuantos[j];
      }
    }
    if (mejor === null || objetivo < mejor.objetivo) mejor = { etiquetas: etiquetas!.slice(), objetivo };
    alAvanzar?.((intento + 1) / nInit);
  }
  return mejor!.etiquetas;
}

// ---------------------------------------------------------------- nombres
/** Los nombres de las personas, uno por línea; sin el encabezado si lo traen. */
export function leerNombres(texto: string): string[] {
  const nombres = texto
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (nombres.length && ["PERSONA", "NOMBRE", "NOMBRES", "PERSONAS", "USUARIO"].includes(normalizar(nombres[0]))) {
    return nombres.slice(1);
  }
  return nombres;
}

// ---------------------------------------------------------------- reparto
export type Reparto = { cap: number; minimo: number; fuera: number };

/**
 * Cuántos puntos le tocan a cada ruta. Parejo: todas con la misma cantidad
 * (±1) si alcanzan los cupos, o exactamente `puntosPorPersona` si sobran
 * puntos. Sin parejo: solo se respeta el máximo y decide la cercanía.
 */
export function calcularReparto(conCoordenadas: number, personas: number, puntosPorPersona: number, parejo: boolean): Reparto {
  const n = conCoordenadas;
  const k = personas;
  const m = puntosPorPersona;
  let cap: number;
  let minimo: number;
  if (!parejo) {
    cap = m;
    minimo = Math.min(1, m);
  } else if (n <= k * m) {
    cap = Math.ceil(n / k);
    minimo = Math.floor(n / k);
  } else {
    cap = m;
    minimo = m;
  }
  return { cap, minimo, fuera: Math.max(0, n - k * cap) };
}

// ---------------------------------------------------------------- principal
export type OpcionesRutas = {
  personas: number;
  puntosPorPersona: number;
  /** true: todas las rutas con la misma cantidad (±1). false: solo el máximo. */
  parejo: boolean;
  nombres: string[];
  /** Para repetir un resultado (pruebas). Sin semilla, cada vez sale distinto. */
  semilla?: number;
};

export type RutaResumen = {
  num: number;
  persona: string;
  puntos: number;
  latCentro: number;
  lonCentro: number;
  distPromKm: number;
  distMaxKm: number;
};

export type ResultadoRutas = {
  /** Por fila del archivo: coordenadas corregidas (null si no se pudo). */
  lat: (number | null)[];
  lon: (number | null)[];
  /** Por fila: número de ruta, o null (sin coordenadas o sin asignar). */
  ruta: (number | null)[];
  /** Por fila: lo que va en la columna PERSONA. */
  persona: string[];
  resumen: RutaResumen[];
  sinAsignar: number;
  sinCoordenadas: number;
  /** Puntos cuyas coordenadas se arreglaron (venían con otro formato o al revés). */
  corregidas: number;
  reparto: Reparto;
  avisos: string[];
  /** Puntos que quedaron en otra ruta que la que les dio el generador (los cambiados a mano, ver reasignar). */
  aMano?: number;
  /** La ruta que les dio el generador, antes de los cambios a mano. */
  rutaGenerada?: (number | null)[];
};

export class ErrorRutas extends Error {}

const red = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Arma las rutas. Lanza ErrorRutas con un mensaje para la pantalla si no se puede. */
export function generarRutas(
  latCrudas: unknown[],
  lonCrudas: unknown[],
  op: OpcionesRutas,
  alAvanzar?: (hecho: number) => void
): ResultadoRutas {
  const k = op.personas;
  const m = op.puntosPorPersona;
  for (const [nombre, valor] of [["personas", k], ["puntos por persona", m]] as const) {
    if (!Number.isInteger(valor) || valor < 1) throw new ErrorRutas(`La cantidad de ${nombre} debe ser un número entero mayor a 0.`);
  }

  const { lat, lon } = corregirCoordenadas(latCrudas, lonCrudas);
  const validos = lat.map((_, i) => i).filter((i) => lat[i] !== null);
  const n = validos.length;
  if (n === 0) throw new ErrorRutas("Ningún punto tiene coordenadas válidas.");
  if (k > n) throw new ErrorRutas(`Hay más personas (${k}) que puntos con coordenadas (${n}).`);

  const reparto = calcularReparto(n, k, m, op.parejo);
  const avisos: string[] = [];
  if (reparto.fuera) {
    avisos.push(
      `${k} personas × ${m} puntos = ${k * m} cupos para ${n} puntos: ${reparto.fuera} puntos (los más alejados) quedan «${SIN_ASIGNAR}».`
    );
  }
  const nombres = op.nombres;
  if (nombres.length && nombres.length < k) {
    avisos.push(`Hay ${nombres.length} nombres y se necesitan ${k}; el resto queda como «PERSONA #».`);
  }

  // ---- agrupar
  const X = aKilometros(validos.map((i) => lat[i]!), validos.map((i) => lon[i]!));
  const nInit = n <= 500 ? 10 : n <= 1200 ? 5 : 3;
  const azar = crearAzar(op.semilla ?? Math.floor(Math.random() * 2 ** 32));
  const etiquetas = kmeansConCapacidad(X, n, k, reparto.cap, reparto.minimo, nInit, azar, alAvanzar);

  // ---- numerar de norte a sur (y de oeste a este si empatan)
  const usadas = [...new Set([...etiquetas].filter((e) => e >= 0))].sort((a, b) => a - b);
  const centro = new Map<number, [number, number]>();
  for (const j of usadas) {
    let sLat = 0;
    let sLon = 0;
    let c = 0;
    etiquetas.forEach((e, pos) => {
      if (e !== j) return;
      sLat += lat[validos[pos]]!;
      sLon += lon[validos[pos]]!;
      c++;
    });
    centro.set(j, [sLat / c, sLon / c]);
  }
  const orden = [...usadas].sort((a, b) => {
    const ra = -red(centro.get(a)![0], 3);
    const rb = -red(centro.get(b)![0], 3);
    return ra !== rb ? ra - rb : centro.get(a)![1] - centro.get(b)![1];
  });
  const numDe = new Map(orden.map((j, i) => [j, i + 1]));
  const personaDe = (num: number) => (num - 1 < nombres.length ? nombres[num - 1] : `PERSONA ${num}`);

  const ruta: (number | null)[] = lat.map(() => null);
  validos.forEach((i, pos) => {
    if (etiquetas[pos] >= 0) ruta[i] = numDe.get(etiquetas[pos])!;
  });
  const persona = ruta.map((num, i) => (num ? personaDe(num) : lat[i] === null ? SIN_COORD : SIN_ASIGNAR));

  const resumen = resumirRutas(lat, ruta, lon, personaDe);

  const corregidas = lat.filter((v, i) => v !== null && (v !== aNumero(latCrudas[i]) || lon[i] !== aNumero(lonCrudas[i]))).length;
  return {
    lat,
    lon,
    ruta,
    persona,
    resumen,
    sinAsignar: lat.filter((v, i) => v !== null && ruta[i] === null).length,
    sinCoordenadas: lat.filter((v) => v === null).length,
    corregidas,
    reparto,
    avisos,
  };
}

/** Puntos, centro y distancias de cada ruta que tenga puntos, en orden de número. */
function resumirRutas(
  lat: (number | null)[],
  ruta: (number | null)[],
  lon: (number | null)[],
  personaDe: (num: number) => string
): RutaResumen[] {
  const porRuta = new Map<number, number[]>();
  ruta.forEach((num, i) => {
    if (num !== null && lat[i] !== null) (porRuta.get(num) ?? porRuta.set(num, []).get(num)!).push(i);
  });
  return [...porRuta.keys()]
    .sort((a, b) => a - b)
    .map((num) => {
      const idx = porRuta.get(num)!;
      const la = idx.map((i) => lat[i]!);
      const lo = idx.map((i) => lon[i]!);
      const cLat = la.reduce((a, b) => a + b, 0) / la.length;
      const cLon = lo.reduce((a, b) => a + b, 0) / lo.length;
      const d = la.map((_, t) => Math.hypot((lo[t] - cLon) * 111.32 * Math.cos((cLat * Math.PI) / 180), (la[t] - cLat) * 110.574));
      return {
        num,
        persona: personaDe(num),
        puntos: idx.length,
        latCentro: red(cLat, 6),
        lonCentro: red(cLon, 6),
        distPromKm: red(d.reduce((a, b) => a + b, 0) / d.length, 2),
        distMaxKm: red(Math.max(...d), 2),
      };
    });
}

// ---------------------------------------------------------------- a mano
/** El número para una persona nueva: el siguiente a la última ruta. */
export const rutaNueva = (r: ResultadoRutas) => Math.max(0, ...r.resumen.map((x) => x.num)) + 1;

/**
 * Pasa esos puntos (índices de fila) a la ruta `destino`: una que ya existe,
 * una nueva (rutaNueva), o ninguna (null: quedan SIN ASIGNAR). Las demás
 * rutas quedan como estaban, con su resumen recalculado; una que se quede sin
 * puntos desaparece. `nombre` es el de la persona si la ruta es nueva (vacío:
 * PERSONA #). Los puntos sin coordenadas no se tocan.
 */
export function reasignar(r: ResultadoRutas, filas: Iterable<number>, destino: number | null, nombre?: string): ResultadoRutas {
  const nombres = new Map(r.resumen.map((x) => [x.num, x.persona]));
  if (destino !== null && !nombres.has(destino)) nombres.set(destino, nombre?.trim() || `PERSONA ${destino}`);
  const personaDe = (num: number) => nombres.get(num) ?? `PERSONA ${num}`;

  const ruta = r.ruta.slice();
  const persona = r.persona.slice();
  let cambiados = 0;
  for (const i of filas) {
    if (r.lat[i] === null || r.lat[i] === undefined || ruta[i] === destino) continue;
    ruta[i] = destino;
    persona[i] = destino === null ? SIN_ASIGNAR : personaDe(destino);
    cambiados++;
  }
  if (cambiados === 0) return r;
  const original = r.rutaGenerada ?? r.ruta;
  return {
    ...r,
    ruta,
    persona,
    resumen: resumirRutas(r.lat, ruta, r.lon, personaDe),
    sinAsignar: r.lat.filter((v, i) => v !== null && ruta[i] === null).length,
    // El aviso de cuántos quedaban sin asignar al generar ya no vale.
    avisos: r.avisos.filter((a) => !a.includes(`quedan «${SIN_ASIGNAR}»`)),
    aMano: ruta.filter((num, i) => num !== original[i]).length,
    rutaGenerada: original,
  };
}

// ---------------------------------------------------------------- mapa
/** Color de la ruta n (1, 2, 3…): los de la paleta de rutas y, después, tonos repartidos. */
export function colorRuta(num: number | null, paleta: readonly string[]): string {
  if (num === null) return "#8a8f98";
  if (num - 1 < paleta.length) return paleta[num - 1];
  return `hsl(${Math.round((num * 137.508) % 360)} 58% 40%)`;
}

/** El contorno (envolvente convexa) de unos puntos [lat, lon], para sombrear cada ruta. */
export function envolvente(puntos: [number, number][]): [number, number][] {
  const p = [...puntos].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (p.length < 3) return p;
  const giro = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const abajo: [number, number][] = [];
  for (const x of p) {
    while (abajo.length >= 2 && giro(abajo[abajo.length - 2], abajo[abajo.length - 1], x) <= 0) abajo.pop();
    abajo.push(x);
  }
  const arriba: [number, number][] = [];
  for (const x of [...p].reverse()) {
    while (arriba.length >= 2 && giro(arriba[arriba.length - 2], arriba[arriba.length - 1], x) <= 0) arriba.pop();
    arriba.push(x);
  }
  return [...abajo.slice(0, -1), ...arriba.slice(0, -1)];
}
