/**
 * Huella visual de una foto (dHash de 64 bits) y su versión chica para la IA.
 * SOLO SERVIDOR: usa sharp.
 *
 * La huella se saca de la foto en gris y reducida a 9×8 puntos: cada bit dice
 * si un punto es más claro que el de su derecha. Dos fotos iguales, aunque una
 * esté recomprimida, con otro tamaño o un poco más clara, dan huellas iguales
 * o con pocos bits distintos; dos tomas distintas difieren en muchos. Cuántos
 * bits distintos se aceptan lo decide la pantalla (lib/repetidas.ts).
 */
import sharp from "sharp";

export type Huella = {
  /** 16 caracteres hexadecimales. */
  huella: string;
  /** La foto es casi de un solo color (negra, en blanco): no se compara. */
  plana: boolean;
};

const MAX_PIXELES = 100_000_000;

export async function sacarHuella(datos: Buffer): Promise<Huella> {
  const { data, info } = await sharp(datos, { failOn: "none", limitInputPixels: MAX_PIXELES })
    .rotate() // la orientación de la cámara (EXIF)
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const paso = info.channels;
  const valor = (x: number, y: number) => data[(y * 9 + x) * paso];
  let alta = 0;
  let baja = 0;
  let minimo = 255;
  let maximo = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 9; x++) {
      const v = valor(x, y);
      if (v < minimo) minimo = v;
      if (v > maximo) maximo = v;
    }
    for (let x = 0; x < 8; x++) {
      const bit = valor(x, y) < valor(x + 1, y) ? 1 : 0;
      const i = y * 8 + x;
      if (i < 32) alta = ((alta << 1) | bit) >>> 0;
      else baja = ((baja << 1) | bit) >>> 0;
    }
  }
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  return { huella: hex(alta) + hex(baja), plana: maximo - minimo < 12 };
}

/**
 * La foto en JPEG de hasta `lado` px por lado, en base64, para mandarla a la
 * IA. Más chica gasta menos tokens y menos tiempo de subida.
 */
export async function fotoParaIA(datos: Buffer, lado = 768): Promise<string> {
  const chica = await sharp(datos, { failOn: "none", limitInputPixels: MAX_PIXELES })
    .rotate()
    .resize(lado, lado, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
  return chica.toString("base64");
}
