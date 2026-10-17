/**
 * ZIP sin compresión, armado en el navegador, para la descarga masiva de
 * fotos. Las fotos (JPEG, PNG…) ya vienen comprimidas: comprimirlas otra vez
 * no ahorra casi nada y es lento, así que se guardan tal cual («store»).
 *
 * Es lo mínimo del formato ZIP (cabecera local, datos, directorio central y
 * cierre), con los nombres en UTF-8 para que las tildes y la ñ salgan bien
 * en Windows, y ZIP64 cuando hace falta: un ZIP de más de 4 GB o de más de
 * 65.535 archivos (Windows 10 y 11, 7-Zip y WinRAR lo abren).
 *
 * Lo que se va armando se manda a un destino: a memoria (y al final sale un
 * Blob para descargar) o a un archivo en el disco que eligió la persona
 * (DestinoArchivo), que no ocupa memoria y no tiene tope de tamaño.
 */

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(datos: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Fecha y hora en el formato de MS-DOS que usa el ZIP (hora local). */
function fechaDos(d: Date): { hora: number; dia: number } {
  const anio = Math.max(1980, Math.min(2107, d.getFullYear()));
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dia: ((anio - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// ----------------------------------------------------------------- destinos

/** A dónde van los bytes del ZIP, en orden. */
export interface DestinoZip {
  escribir(bytes: Uint8Array): void;
  /** Espera si hay mucho pendiente por escribir (para no llenar la memoria). */
  espacio(): Promise<void>;
  /** Termina de escribir. En memoria devuelve el Blob; en un archivo, null. */
  terminar(): Promise<Blob | null>;
  /** Deja todo sin guardar. */
  abortar(): Promise<void>;
}

/**
 * En memoria. Cada 32 MB los trozos se juntan en un Blob: el navegador puede
 * guardarlo fuera de la memoria de la página, y al final no se copia todo de
 * una vez.
 */
export class DestinoMemoria implements DestinoZip {
  private trozos: Uint8Array[] = [];
  private enTrozos = 0;
  private blobs: Blob[] = [];

  escribir(bytes: Uint8Array) {
    this.trozos.push(bytes);
    this.enTrozos += bytes.length;
    if (this.enTrozos >= 32 * 1024 * 1024) this.juntar();
  }

  private juntar() {
    if (this.trozos.length) this.blobs.push(new Blob(this.trozos as BlobPart[]));
    this.trozos = [];
    this.enTrozos = 0;
  }

  async espacio() {}

  async terminar() {
    this.juntar();
    const blob = new Blob(this.blobs, { type: "application/zip" });
    this.blobs = [];
    return blob;
  }

  async abortar() {
    this.trozos = [];
    this.blobs = [];
  }
}

/** Lo que hace falta de un archivo abierto para escribir (FileSystemWritableFileStream). */
export type ArchivoEscribible = {
  write(datos: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};

/**
 * Directo a un archivo en el disco (el que se eligió en «Guardar como»):
 * cada trozo se escribe en orden, sin quedarse en memoria. Si el disco va más
 * lento que la descarga, `espacio()` hace esperar con más de 16 MB pendientes.
 */
export class DestinoArchivo implements DestinoZip {
  private cola: Promise<void> = Promise.resolve();
  private pendientes = 0;
  private fallo: Error | null = null;

  constructor(private archivo: ArchivoEscribible) {}

  escribir(bytes: Uint8Array) {
    if (this.fallo) throw this.fallo;
    this.pendientes += bytes.length;
    this.cola = this.cola.then(async () => {
      if (this.fallo) return;
      try {
        await this.archivo.write(bytes);
      } catch (e) {
        this.fallo = e instanceof Error ? e : new Error(String(e));
      } finally {
        this.pendientes -= bytes.length;
      }
    });
  }

  async espacio() {
    while (this.pendientes > 16 * 1024 * 1024 && !this.fallo) await this.cola;
    if (this.fallo) throw this.fallo;
  }

  async terminar() {
    await this.cola;
    if (this.fallo) throw this.fallo;
    await this.archivo.close();
    return null;
  }

  async abortar() {
    this.fallo ??= new Error("Se detuvo.");
    await this.cola.catch(() => {});
    await this.archivo.abort().catch(() => {});
  }
}

// ----------------------------------------------------------------- el ZIP

type Entrada = { nombre: Uint8Array; crc: number; tamano: number; desplazamiento: number; hora: number; dia: number; carpeta: boolean };

const UTF8 = 0x0800;
const TOPE_32 = 0xffffffff;
const TOPE_16 = 0xffff;

export class ZipSimple {
  private entradas: Entrada[] = [];
  private desplazamiento = 0;
  private codificador = new TextEncoder();

  /**
   * `zip64: "siempre"` escribe las estructuras ZIP64 aunque no hagan falta
   * (para probarlas sin armar 4 GB); por defecto, solo cuando hacen falta.
   */
  constructor(
    private destino: DestinoZip = new DestinoMemoria(),
    private opciones: { zip64?: "siempre" | "si-hace-falta" } = {}
  ) {}

  /** Bytes escritos hasta ahora (sin el directorio del final). */
  get tamano(): number {
    return this.desplazamiento;
  }

  get cantidad(): number {
    return this.entradas.length;
  }

  private escribir(bytes: Uint8Array) {
    this.destino.escribir(bytes);
    this.desplazamiento += bytes.length;
  }

  private cabeceraLocal(nombre: Uint8Array, crc: number, tamano: number, hora: number, dia: number): Uint8Array {
    const b = new Uint8Array(30 + nombre.length);
    const v = new DataView(b.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true); // versión necesaria
    v.setUint16(6, UTF8, true);
    v.setUint16(8, 0, true); // sin compresión
    v.setUint16(10, hora, true);
    v.setUint16(12, dia, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, tamano, true);
    v.setUint32(22, tamano, true);
    v.setUint16(26, nombre.length, true);
    v.setUint16(28, 0, true);
    b.set(nombre, 30);
    return b;
  }

  /** Agrega un archivo (de menos de 4 GB). `nombre` con «/» para las carpetas: «CICLO 1/foto.jpg». */
  agregar(nombre: string, datos: Uint8Array, fecha = new Date()) {
    if (datos.length >= TOPE_32) throw new Error(`«${nombre}» pesa 4 GB o más.`);
    const n = this.codificador.encode(nombre);
    const { hora, dia } = fechaDos(fecha);
    const crc = crc32(datos);
    this.entradas.push({ nombre: n, crc, tamano: datos.length, desplazamiento: this.desplazamiento, hora, dia, carpeta: false });
    this.escribir(this.cabeceraLocal(n, crc, datos.length, hora, dia));
    this.escribir(datos);
  }

  /** Una carpeta vacía (termina en «/»). Algunos programas la necesitan para mostrarla. */
  agregarCarpeta(nombre: string, fecha = new Date()) {
    const n = this.codificador.encode(nombre.endsWith("/") ? nombre : `${nombre}/`);
    const { hora, dia } = fechaDos(fecha);
    this.entradas.push({ nombre: n, crc: 0, tamano: 0, desplazamiento: this.desplazamiento, hora, dia, carpeta: true });
    this.escribir(this.cabeceraLocal(n, 0, 0, hora, dia));
  }

  /** Espera si el destino va atrasado (ver DestinoArchivo). */
  espacio(): Promise<void> {
    return this.destino.espacio();
  }

  /** Cierra el ZIP. En memoria devuelve el Blob para descargar; en un archivo, null. */
  async cerrar(): Promise<Blob | null> {
    const siempre = this.opciones.zip64 === "siempre";
    const inicio = this.desplazamiento;
    for (const e of this.entradas) {
      // Un archivo que empieza después de los 4 GB lleva su posición en el campo extra de ZIP64.
      const largo64 = siempre || e.desplazamiento >= TOPE_32;
      const extra = largo64 ? 12 : 0;
      const b = new Uint8Array(46 + e.nombre.length + extra);
      const v = new DataView(b.buffer);
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, largo64 ? 45 : 20, true); // hecho con
      v.setUint16(6, largo64 ? 45 : 20, true); // versión necesaria
      v.setUint16(8, UTF8, true);
      v.setUint16(10, 0, true);
      v.setUint16(12, e.hora, true);
      v.setUint16(14, e.dia, true);
      v.setUint32(16, e.crc, true);
      v.setUint32(20, e.tamano, true);
      v.setUint32(24, e.tamano, true);
      v.setUint16(28, e.nombre.length, true);
      v.setUint16(30, extra, true);
      v.setUint16(32, 0, true);
      v.setUint16(34, 0, true);
      v.setUint16(36, 0, true);
      v.setUint32(38, e.carpeta ? 0x10 : 0, true);
      v.setUint32(42, largo64 ? TOPE_32 : e.desplazamiento, true);
      b.set(e.nombre, 46);
      if (largo64) {
        const x = 46 + e.nombre.length;
        v.setUint16(x, 0x0001, true);
        v.setUint16(x + 2, 8, true);
        v.setBigUint64(x + 4, BigInt(e.desplazamiento), true);
      }
      this.escribir(b);
    }
    const tamanoDirectorio = this.desplazamiento - inicio;
    const n = this.entradas.length;
    const zip64 = siempre || n >= TOPE_16 || inicio >= TOPE_32 || tamanoDirectorio >= TOPE_32 || this.desplazamiento >= TOPE_32;

    if (zip64) {
      const finDirectorio64 = this.desplazamiento;
      const r = new Uint8Array(56);
      const v = new DataView(r.buffer);
      v.setUint32(0, 0x06064b50, true);
      v.setBigUint64(4, BigInt(44), true); // lo que queda de este registro
      v.setUint16(12, 45, true);
      v.setUint16(14, 45, true);
      v.setUint32(16, 0, true);
      v.setUint32(20, 0, true);
      v.setBigUint64(24, BigInt(n), true);
      v.setBigUint64(32, BigInt(n), true);
      v.setBigUint64(40, BigInt(tamanoDirectorio), true);
      v.setBigUint64(48, BigInt(inicio), true);
      this.escribir(r);
      const l = new Uint8Array(20);
      const w = new DataView(l.buffer);
      w.setUint32(0, 0x07064b50, true);
      w.setUint32(4, 0, true);
      w.setBigUint64(8, BigInt(finDirectorio64), true);
      w.setUint32(16, 1, true);
      this.escribir(l);
    }

    const fin = new Uint8Array(22);
    const v = new DataView(fin.buffer);
    v.setUint32(0, 0x06054b50, true);
    // Lo que no cabe va en 0xFFFF / 0xFFFFFFFF y se lee del registro ZIP64.
    v.setUint16(8, Math.min(n, TOPE_16), true);
    v.setUint16(10, Math.min(n, TOPE_16), true);
    v.setUint32(12, Math.min(tamanoDirectorio, TOPE_32), true);
    v.setUint32(16, Math.min(inicio, TOPE_32), true);
    this.escribir(fin);
    return this.destino.terminar();
  }

  /** Lo deja sin guardar (al detener la descarga). */
  abortar(): Promise<void> {
    return this.destino.abortar();
  }
}
