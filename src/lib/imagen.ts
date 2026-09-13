import { colorDeRuta, type PuntoCartera } from "./tipos";

/**
 * Arma la cartera como una sola imagen PNG, pensada para mandar por WhatsApp
 * o tener a mano sin datos: encabezado, mapa y lista numerada.
 *
 * Todo se dibuja en un canvas, sin librerías: html2canvas no sirve aquí porque
 * el mapa de Leaflet son cientos de nodos y capas superpuestas, y el resultado
 * sale cortado en móvil.
 */

const ANCHO = 1080;
const MARGEN = 48;
const ALTO_MAPA = 640;
const ALTO_FILA = 104;
const MAX_FILAS = 40;
const TAM_TILE = 256;
const MAX_TILES = 64;

const TIPOGRAFIA =
  '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

// --------------------------------------------------------- proyección slippy
function lonAx(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

function latAy(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

function cargarTile(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // Sin crossOrigin el canvas queda contaminado y toBlob falla. Si el
    // servidor no responde con cabeceras CORS, la carga falla y seguimos
    // sin ese tile en vez de romper la descarga entera.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function textoCortado(
  ctx: CanvasRenderingContext2D,
  texto: string,
  anchoMax: number
): string {
  if (ctx.measureText(texto).width <= anchoMax) return texto;
  let corte = texto;
  while (corte.length > 1 && ctx.measureText(`${corte}…`).width > anchoMax) {
    corte = corte.slice(0, -1);
  }
  return `${corte}…`;
}

// --------------------------------------------------------- mapa
async function dibujarMapa(
  ctx: CanvasRenderingContext2D,
  puntos: PuntoCartera[],
  y0: number
): Promise<void> {
  const anchoMapa = ANCHO - MARGEN * 2;
  const conCoords = puntos.filter((p) => p.latitud !== null && p.longitud !== null);

  ctx.fillStyle = "#e8eae6";
  ctx.fillRect(MARGEN, y0, anchoMapa, ALTO_MAPA);

  if (conCoords.length === 0) {
    ctx.fillStyle = "#55676f";
    ctx.font = `500 26px ${TIPOGRAFIA}`;
    ctx.textAlign = "center";
    ctx.fillText(
      "Ningún punto tiene ubicación registrada",
      ANCHO / 2,
      y0 + ALTO_MAPA / 2
    );
    ctx.textAlign = "left";
    return;
  }

  const lats = conCoords.map((p) => p.latitud as number);
  const lngs = conCoords.map((p) => p.longitud as number);

  // Margen mínimo para que un solo punto no genere un bbox de tamaño cero.
  const holgura = 0.002;
  const latMin = Math.min(...lats) - holgura;
  const latMax = Math.max(...lats) + holgura;
  const lngMin = Math.min(...lngs) - holgura;
  const lngMax = Math.max(...lngs) + holgura;

  const relleno = 56;
  let zoom = 17;
  while (zoom > 2) {
    const ancho = (lonAx(lngMax, zoom) - lonAx(lngMin, zoom)) * TAM_TILE;
    const alto = (latAy(latMin, zoom) - latAy(latMax, zoom)) * TAM_TILE;
    if (ancho <= anchoMapa - relleno && alto <= ALTO_MAPA - relleno) break;
    zoom--;
  }

  const xMin = lonAx(lngMin, zoom);
  const xMax = lonAx(lngMax, zoom);
  const yMin = latAy(latMax, zoom);
  const yMax = latAy(latMin, zoom);

  // Centramos el recuadro de puntos dentro del panel.
  const offsetX = MARGEN + (anchoMapa - (xMax - xMin) * TAM_TILE) / 2 - xMin * TAM_TILE;
  const offsetY = y0 + (ALTO_MAPA - (yMax - yMin) * TAM_TILE) / 2 - yMin * TAM_TILE;

  const tx0 = Math.floor(xMin - relleno / TAM_TILE);
  const tx1 = Math.floor(xMax + relleno / TAM_TILE);
  const ty0 = Math.floor(yMin - relleno / TAM_TILE);
  const ty1 = Math.floor(yMax + relleno / TAM_TILE);

  const pedidos: { img: Promise<HTMLImageElement | null>; x: number; y: number }[] = [];
  for (let tx = tx0; tx <= tx1 && pedidos.length < MAX_TILES; tx++) {
    for (let ty = ty0; ty <= ty1 && pedidos.length < MAX_TILES; ty++) {
      pedidos.push({
        img: cargarTile(`https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`),
        x: tx,
        y: ty,
      });
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(MARGEN, y0, anchoMapa, ALTO_MAPA);
  ctx.clip();

  let dibujados = 0;
  for (const t of pedidos) {
    const img = await t.img;
    if (!img) continue;
    ctx.drawImage(
      img,
      offsetX + t.x * TAM_TILE,
      offsetY + t.y * TAM_TILE,
      TAM_TILE,
      TAM_TILE
    );
    dibujados++;
  }

  if (dibujados === 0) {
    // Sin tiles queda al menos una retícula para dar sentido de escala.
    ctx.strokeStyle = "#d7dbd6";
    ctx.lineWidth = 1;
    for (let x = MARGEN; x < MARGEN + anchoMapa; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y0 + ALTO_MAPA);
      ctx.stroke();
    }
    for (let y = y0; y < y0 + ALTO_MAPA; y += 60) {
      ctx.beginPath();
      ctx.moveTo(MARGEN, y);
      ctx.lineTo(MARGEN + anchoMapa, y);
      ctx.stroke();
    }
  }

  // Marcadores
  conCoords.forEach((p, i) => {
    const cx = offsetX + lonAx(p.longitud as number, zoom) * TAM_TILE;
    const cy = offsetY + latAy(p.latitud as number, zoom) * TAM_TILE;
    const r = 20;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = colorDeRuta(p.ruta);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = `600 19px ${TIPOGRAFIA}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), cx, cy + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  });

  ctx.restore();

  // Atribución: obligatoria al reutilizar los tiles de OpenStreetMap.
  if (dibujados > 0) {
    const credito = "© OpenStreetMap";
    ctx.font = `400 17px ${TIPOGRAFIA}`;
    const w = ctx.measureText(credito).width + 16;
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.fillRect(MARGEN + anchoMapa - w, y0 + ALTO_MAPA - 28, w, 28);
    ctx.fillStyle = "#42545b";
    ctx.fillText(credito, MARGEN + anchoMapa - w + 8, y0 + ALTO_MAPA - 9);
  }

  ctx.strokeStyle = "#cfd6d2";
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGEN + 0.5, y0 + 0.5, anchoMapa - 1, ALTO_MAPA - 1);
}

// --------------------------------------------------------- imagen completa
export async function exportarCarteraImagen(
  puntos: PuntoCartera[],
  vendedor: { usuario: string; nombre: string | null }
): Promise<void> {
  const visibles = puntos.slice(0, MAX_FILAS);
  const sobrantes = puntos.length - visibles.length;

  const alto =
    196 + ALTO_MAPA + 40 + visibles.length * ALTO_FILA + (sobrantes > 0 ? 52 : 0) + 64;

  const canvas = document.createElement("canvas");
  // Doble resolución: en pantallas densas el texto se ve nítido y el archivo
  // sigue siendo razonable.
  const escala = 2;
  canvas.width = ANCHO * escala;
  canvas.height = alto * escala;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no permitió crear la imagen.");
  ctx.scale(escala, escala);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ANCHO, alto);

  // Encabezado
  ctx.fillStyle = "#16242b";
  ctx.fillRect(0, 0, ANCHO, 148);

  ctx.fillStyle = "#ffffff";
  ctx.font = `600 40px ${TIPOGRAFIA}`;
  ctx.fillText(
    textoCortado(ctx, vendedor.nombre ?? vendedor.usuario, ANCHO - MARGEN * 2),
    MARGEN,
    68
  );

  const fecha = new Date().toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  ctx.fillStyle = "#a8b8bd";
  ctx.font = `400 24px ${TIPOGRAFIA}`;
  ctx.fillText(
    `${vendedor.usuario} · ${puntos.length} ${
      puntos.length === 1 ? "punto" : "puntos"
    } · ${fecha}`,
    MARGEN,
    108
  );

  await dibujarMapa(ctx, puntos, 196);

  // Lista
  let y = 196 + ALTO_MAPA + 40;
  const conCoords = puntos.filter((p) => p.latitud !== null && p.longitud !== null);

  visibles.forEach((p) => {
    // La numeración del mapa solo cubre los puntos ubicados; los demás
    // llevan guion para que nadie los busque en el mapa en vano.
    const indiceMapa = conCoords.indexOf(p);
    const etiqueta = indiceMapa >= 0 ? String(indiceMapa + 1) : "–";

    ctx.beginPath();
    ctx.arc(MARGEN + 22, y + 26, 22, 0, Math.PI * 2);
    ctx.fillStyle = colorDeRuta(p.ruta);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = `600 21px ${TIPOGRAFIA}`;
    ctx.textAlign = "center";
    ctx.fillText(etiqueta, MARGEN + 22, y + 33);
    ctx.textAlign = "left";

    const x = MARGEN + 60;
    const anchoTexto = ANCHO - x - MARGEN;

    ctx.fillStyle = "#16242b";
    ctx.font = `500 26px ${TIPOGRAFIA}`;
    ctx.fillText(
      textoCortado(ctx, p.pdv ?? "Punto sin nombre", anchoTexto),
      x,
      y + 26
    );

    ctx.fillStyle = "#55676f";
    ctx.font = `400 23px ${TIPOGRAFIA}`;
    ctx.fillText(
      textoCortado(ctx, p.direccion ?? "Sin dirección registrada", anchoTexto),
      x,
      y + 57
    );

    const pie = [p.que_hacer, p.celular, p.persona_hacku]
      .filter(Boolean)
      .join("  ·  ");
    ctx.fillStyle = "#6b7c83";
    ctx.font = `400 21px ${TIPOGRAFIA}`;
    ctx.fillText(textoCortado(ctx, pie, anchoTexto), x, y + 86);

    y += ALTO_FILA;

    ctx.strokeStyle = "#e4e8e4";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGEN, y - 14.5);
    ctx.lineTo(ANCHO - MARGEN, y - 14.5);
    ctx.stroke();
  });

  if (sobrantes > 0) {
    ctx.fillStyle = "#55676f";
    ctx.font = `400 23px ${TIPOGRAFIA}`;
    ctx.fillText(
      `Y ${sobrantes} punto(s) más. Descarga el Excel para verlos todos.`,
      MARGEN,
      y + 24
    );
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png")
  );
  if (!blob) throw new Error("No se pudo generar la imagen.");

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Cartera_${vendedor.usuario}_${new Date()
    .toISOString()
    .slice(0, 10)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
