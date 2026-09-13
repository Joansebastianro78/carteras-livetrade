/**
 * Normalización de la plantilla maestra (101_BOGOTA_12_SEP.xlsx y similares).
 * Se usa igual en cliente (parseo del Excel) y en servidor (validación).
 */

/** Texto limpio; convierte números a string sin notación científica. */
export function aTexto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return null;
    // 573132486266 no debe quedar como "5.73132486266e+11"
    const s = Number.isInteger(valor) ? valor.toFixed(0) : String(valor);
    return s.trim() || null;
  }
  const s = String(valor).trim();
  if (!s || s.toLowerCase() === "nan" || s.toLowerCase() === "null") return null;
  return s;
}

export function aEntero(valor: unknown): number | null {
  const t = aTexto(valor);
  if (t === null) return null;
  const n = Number.parseInt(t.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Límites de Colombia. El ajuste de coordenadas es deliberadamente específico
 * del país: si algún día la operación sale de Colombia, hay que cambiar estos
 * dos valores o el corrector dejará puntos mal ubicados.
 */
export const LIMITE_LAT = 13.5; // Punta Gallinas
export const LIMITE_LNG = 82; // Isla de Malpelo / San Andrés

/**
 * Corrige coordenadas a las que el origen les perdió el separador decimal.
 * En la plantilla de Bogotá hay 9 filas así: 473669 en vez de 4.73669,
 * -7408943176 en vez de -74.08943176. Se divide entre 10 hasta caer en rango.
 *
 * Importante: el límite debe ser el del país, no el global de ±90/±180.
 * Con 90 como tope, 473669 se detiene en 47.3669 (que es una latitud válida
 * en el mundo, pero imposible en Colombia) y el punto queda en Francia.
 *
 * Devuelve [valor, seCorrigio]; null si no se puede recuperar.
 */
export function normalizarCoordenada(
  valor: unknown,
  limite: number
): [number | null, boolean] {
  const t = aTexto(valor);
  if (t === null) return [null, false];

  let n = Number(t.replace(",", "."));
  if (!Number.isFinite(n) || n === 0) return [null, false];

  let corregida = false;
  let vueltas = 0;
  while (Math.abs(n) > limite && vueltas < 12) {
    n = n / 10;
    corregida = true;
    vueltas++;
  }

  if (Math.abs(n) > limite) return [null, false];
  return [Number(n.toFixed(8)), corregida];
}

/** Bounding box de Colombia: descarta coordenadas irrecuperables. */
export function dentroDeColombia(lat: number, lng: number): boolean {
  return lat > -4.5 && lat < LIMITE_LAT && lng > -LIMITE_LNG && lng < -66;
}

/** Fecha a 'YYYY-MM-DD'. Acepta Date, serial de Excel o texto dd/mm/yyyy. */
export function aFecha(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return valor.toISOString().slice(0, 10);
  }

  if (typeof valor === "number") {
    if (!Number.isFinite(valor) || valor <= 0) return null;
    // Serial de Excel (base 1899-12-30)
    const ms = Math.round((valor - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  const t = String(valor).trim();
  if (!t) return null;

  const dmy = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) {
    const [, d, m, a] = dmy;
    return `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];

  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Hora a 'HH:MM:SS'. Acepta texto o fracción de día de Excel. */
export function aHora(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;

  if (typeof valor === "number" && Number.isFinite(valor)) {
    const frac = valor - Math.floor(valor);
    const total = Math.round(frac * 86400);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h, m, s].map((x) => String(x).padStart(2, "0")).join(":");
  }

  const t = String(valor).trim();
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(t) ? t : null;
}

/** Usuario: BAV172. Se normaliza a mayúsculas sin espacios. */
export function normalizarUsuario(valor: unknown): string {
  return (aTexto(valor) ?? "").toUpperCase().replace(/\s+/g, "");
}

/**
 * Cédula: admite números, letras y otros caracteres (algunos documentos
 * traen guiones, puntos o letras). Se normaliza a mayúsculas y sin espacios
 * para que la comparación sea consistente; 'LIBRE' sigue siendo el marcador
 * de puntos sin vendedor asignado.
 */
export function normalizarCedula(valor: unknown): string {
  const t = (aTexto(valor) ?? "").toUpperCase().trim();
  return t.replace(/\s+/g, "");
}
