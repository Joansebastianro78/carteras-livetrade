/**
 * Capas base de los mapas: el del consultor, el del filtro por departamento y
 * ciudad, y la imagen que se descarga. Cada persona elige la suya con el
 * botón "Capas" del mapa y la elección queda guardada en su navegador.
 *
 * Mapbox se activa con NEXT_PUBLIC_MAPBOX_TOKEN. Sin él, las opciones son
 * OpenStreetMap y MapLibre, que no piden llave.
 *
 * El token de Mapbox es público a propósito (empieza por "pk."): viaja al
 * navegador en cada tile, así que se protege restringiéndolo por dominio en la
 * cuenta de Mapbox, no escondiéndolo. Las variables NEXT_PUBLIC_ se escriben
 * en el código al compilar: después de cambiarlas hay que volver a desplegar.
 */

// Next solo reemplaza process.env.NEXT_PUBLIC_* cuando se escribe completo.
const TOKEN = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "").trim();

export const USA_MAPBOX = TOKEN.length > 0;

export type IdCapa =
  | "mapbox-calles"
  | "mapbox-satelite"
  | "mapbox-claro"
  | "maplibre"
  | "osm";

export type FuenteRaster = {
  tipo: "raster";
  url: string;
  attribution: string;
  tileSize: number;
  zoomOffset: number;
  maxZoom: number;
};

/** Mapa vectorial dibujado con MapLibre GL a partir de un estilo. */
export type FuenteMapLibre = { tipo: "maplibre"; estilo: string };

export type Capa = {
  id: IdCapa;
  nombre: string;
  fuente: FuenteRaster | FuenteMapLibre;
  /** Imagen pequeña para el selector; null si se dibuja aparte (MapLibre). */
  miniatura: string | null;
};

// ---------------------------------------------------------------- Mapbox
const ATRIBUCION_MAPBOX =
  '&copy; <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noreferrer">Mapbox</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> ' +
  '<a href="https://apps.mapbox.com/feedback/" target="_blank" rel="noreferrer"><strong>Mejorar este mapa</strong></a>';

const ESTILOS_MAPBOX = {
  "mapbox-calles": "mapbox/streets-v12",
  "mapbox-satelite": "mapbox/satellite-streets-v12",
  "mapbox-claro": "mapbox/light-v11",
} as const;

/**
 * Tiles de 512 px con zoomOffset -1: cubren lo mismo que cuatro de 256 y
 * Mapbox cobra por tile, así que salen cuatro veces más baratos. {r} pide la
 * versión @2x solo en pantallas de alta densidad.
 */
function rasterMapbox(estilo: string, atribucionExtra = ""): FuenteRaster {
  return {
    tipo: "raster",
    url: `https://api.mapbox.com/styles/v1/${estilo}/tiles/512/{z}/{x}/{y}{r}?access_token=${TOKEN}`,
    attribution: ATRIBUCION_MAPBOX + atribucionExtra,
    tileSize: 512,
    zoomOffset: -1,
    maxZoom: 20,
  };
}

// ---------------------------------------------------------- miniaturas
/**
 * Las miniaturas son un tile fijo sobre Bogotá (el Salitre: parque, lago y
 * calles), el mismo para todas las capas. El navegador lo guarda en caché, así
 * que cuesta una petición por capa y por dispositivo.
 */
const MINI_LAT = 4.6584;
const MINI_LNG = -74.0937;
const MINI_Z = 14;

function tileDe(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
  };
}

const MINI = tileDe(MINI_LAT, MINI_LNG, MINI_Z);

function miniaturaMapbox(estilo: string): string {
  return `https://api.mapbox.com/styles/v1/${estilo}/tiles/256/${MINI_Z}/${MINI.x}/${MINI.y}?access_token=${TOKEN}`;
}

// ---------------------------------------------------------------- catálogo
const OSM: Capa = {
  id: "osm",
  nombre: "OpenStreetMap",
  fuente: {
    tipo: "raster",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    tileSize: 256,
    zoomOffset: 0,
    maxZoom: 19,
  },
  miniatura: `https://tile.openstreetmap.org/${MINI_Z}/${MINI.x}/${MINI.y}.png`,
};

/**
 * MapLibre GL con el estilo Liberty de OpenFreeMap: mapa vectorial, sin llave
 * y sin límite de vistas. La atribución la pone el propio estilo.
 */
const MAPLIBRE: Capa = {
  id: "maplibre",
  nombre: "MapLibre",
  fuente: { tipo: "maplibre", estilo: "https://tiles.openfreemap.org/styles/liberty" },
  miniatura: null,
};

/** En el orden en que salen en el selector. */
export const CAPAS: Capa[] = USA_MAPBOX
  ? [
      {
        id: "mapbox-calles",
        nombre: "Calles",
        fuente: rasterMapbox(ESTILOS_MAPBOX["mapbox-calles"]),
        miniatura: miniaturaMapbox(ESTILOS_MAPBOX["mapbox-calles"]),
      },
      {
        id: "mapbox-satelite",
        nombre: "Satélite",
        // Las imágenes satelitales de Mapbox exigen además el crédito de Maxar.
        fuente: rasterMapbox(
          ESTILOS_MAPBOX["mapbox-satelite"],
          ' &copy; <a href="https://www.maxar.com/" target="_blank" rel="noreferrer">Maxar</a>'
        ),
        miniatura: miniaturaMapbox(ESTILOS_MAPBOX["mapbox-satelite"]),
      },
      {
        id: "mapbox-claro",
        nombre: "Claro",
        fuente: rasterMapbox(ESTILOS_MAPBOX["mapbox-claro"]),
        miniatura: miniaturaMapbox(ESTILOS_MAPBOX["mapbox-claro"]),
      },
      MAPLIBRE,
    ]
  : [OSM, MAPLIBRE];

export const CAPA_POR_DEFECTO: IdCapa = CAPAS[0].id;

export function buscarCapa(id: IdCapa): Capa {
  return CAPAS.find((c) => c.id === id) ?? CAPAS[0];
}

// ------------------------------------------------------- elección guardada
const LLAVE = "cartera.capa-mapa";

/** La capa que eligió esta persona en este navegador, si sigue disponible. */
export function capaGuardada(): IdCapa {
  try {
    const guardada = window.localStorage.getItem(LLAVE);
    if (guardada && CAPAS.some((c) => c.id === guardada)) return guardada as IdCapa;
  } catch {
    // Navegación privada o almacenamiento bloqueado: se usa la de siempre.
  }
  return CAPA_POR_DEFECTO;
}

export function guardarCapa(id: IdCapa) {
  try {
    window.localStorage.setItem(LLAVE, id);
  } catch {
    // Sin almacenamiento la elección dura lo que dure la página.
  }
}

// ------------------------------------------------- imagen para descargar
/**
 * Qué fondo lleva la imagen PNG según la capa elegida. Si es de Mapbox, el
 * mismo estilo. MapLibre no tiene imagen fija equivalente: con token sale el
 * de calles de Mapbox, sin token OpenStreetMap.
 */
export function estiloImagenMapbox(id: IdCapa): string | null {
  if (!USA_MAPBOX) return null;
  if (id === "osm") return null;
  if (id in ESTILOS_MAPBOX) return ESTILOS_MAPBOX[id as keyof typeof ESTILOS_MAPBOX];
  return ESTILOS_MAPBOX["mapbox-calles"];
}

/**
 * Imagen fija de Mapbox (Static Images API) para la descarga en PNG: una
 * sola petición en vez de un tile por cuadro. La imagen trae dentro el logo y
 * la atribución de Mapbox, que son obligatorios.
 *
 * `zoom256` es el zoom en la cuadrícula clásica de 256 px que usa imagen.ts;
 * Mapbox cuenta el zoom sobre tiles de 512, así que es uno menos. Ancho y
 * alto van en píxeles lógicos (máximo 1280 cada uno); @2x duplica la
 * resolución real.
 */
export function urlImagenMapbox(
  estilo: string,
  lat: number,
  lng: number,
  zoom256: number,
  ancho: number,
  alto: number
): string {
  const z = Math.max(0, zoom256 - 1);
  const w = Math.min(1280, Math.round(ancho));
  const h = Math.min(1280, Math.round(alto));
  return (
    `https://api.mapbox.com/styles/v1/${estilo}/static/` +
    `${lng.toFixed(6)},${lat.toFixed(6)},${z}/${w}x${h}@2x?access_token=${TOKEN}`
  );
}
