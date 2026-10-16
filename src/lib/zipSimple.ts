/**
 * ZIP sin compresión, armado en el navegador, para la descarga masiva de
 * fotos. Las fotos (JPEG, PNG…) ya vienen comprimidas: comprimirlas otra vez
 * no ahorra casi nada y es lento, así que se guardan tal cual («store»).
 *
 * Es lo mínimo del formato ZIP (cabecera local, datos, directorio central y
 * cierre), con los nombres en UTF-8 para que las tildes y la ñ salgan bien
 * en Windows. Sin ZIP64: cada archivo debe quedar por debajo de 4 GB y de
 * 65.535 entradas, por eso la descarga lo parte en varios ZIP mucho antes.
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

type Entrada = { nombre: Uint8Array; crc: number; tamano: number; desplazamiento: number; hora: number; dia: number; carpeta: boolean };

const UTF8 = 0x0800;

export class ZipSimple {
  private trozos: Uint8Array[] = [];
  private entradas: Entrada[] = [];
  private desplazamiento = 0;
  private codificador = new TextEncoder();

  /** Bytes escritos hasta ahora (sin el directorio del final). */
  get tamano(): number {
    return this.desplazamiento;
  }

  get cantidad(): number {
    return this.entradas.length;
  }

  private escribir(bytes: Uint8Array) {
    this.trozos.push(bytes);
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

  /** Agrega un archivo. `nombre` con «/» para las carpetas: «CICLO 1/foto.jpg». */
  agregar(nombre: string, datos: Uint8Array, fecha = new Date()) {
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

  /** Cierra el ZIP y lo entrega. Después de esto no se puede agregar nada. */
  cerrar(): Blob {
    const inicio = this.desplazamiento;
    for (const e of this.entradas) {
      const b = new Uint8Array(46 + e.nombre.length);
      const v = new DataView(b.buffer);
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true); // hecho con
      v.setUint16(6, 20, true); // versión necesaria
      v.setUint16(8, UTF8, true);
      v.setUint16(10, 0, true);
      v.setUint16(12, e.hora, true);
      v.setUint16(14, e.dia, true);
      v.setUint32(16, e.crc, true);
      v.setUint32(20, e.tamano, true);
      v.setUint32(24, e.tamano, true);
      v.setUint16(28, e.nombre.length, true);
      v.setUint16(30, 0, true);
      v.setUint16(32, 0, true);
      v.setUint16(34, 0, true);
      v.setUint16(36, 0, true);
      v.setUint32(38, e.carpeta ? 0x10 : 0, true);
      v.setUint32(42, e.desplazamiento, true);
      b.set(e.nombre, 46);
      this.escribir(b);
    }
    const fin = new Uint8Array(22);
    const v = new DataView(fin.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, this.entradas.length, true);
    v.setUint16(10, this.entradas.length, true);
    v.setUint32(12, this.desplazamiento - inicio, true);
    v.setUint32(16, inicio, true);
    this.escribir(fin);
    const blob = new Blob(this.trozos as BlobPart[], { type: "application/zip" });
    this.trozos = [];
    return blob;
  }
}
