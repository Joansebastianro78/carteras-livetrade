/**
 * Módulo de auditoría: tipos y reglas que usan la ruta /api/admin/auditoria
 * y el navegador. Sin AWS ni Supabase aquí.
 */
import { limpiarTexto } from "./limpiadorAuditoria";

/** Columnas de la consulta, en su orden y con su alias de Athena. */
export const COLUMNAS_AUDITORIA = [
  "codigo_bavaria",
  "nombre_personalizado",
  "nombre_usuario",
  "departamento",
  "provincia",
  "componente_etiqueta",
  "componente_valor",
  "fecha",
  "actividad_id",
  "tipo_linea",
] as const;

export type ColumnaAuditoria = (typeof COLUMNAS_AUDITORIA)[number];

export type FilaAuditoria = Record<ColumnaAuditoria, string | null> & {
  /** Por qué salió la fila; se calcula en el navegador, no viene de Athena. */
  motivo: string;
};

// ---------------------------------------------------------------- motivos
const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const MOTIVOS = {
  cedula: "Número de identificación inválido",
  nacimiento: "Dueño menor de 18 años",
  domicilios: "Domicilios: «No» junto a otra opción",
  select: "Pregunta sin responder («Select»)",
  anos: "Años mayores a 50",
  porcentaje: "Porcentaje mayor a 100",
  costos: "Costos del mes fuera de $100 mil a $30 M",
  ventas: "Ventas del día fuera de $10 mil a $2 M",
  edad: "Participante menor de 18 años",
  otro: "Otro",
} as const;

/** Preguntas de opción múltiple donde la consulta trae los «Select». */
const PREGUNTAS_SELECT = [
  /para dar a conocer su negocio o vender/,
  /con qu.*proveedores\?/,
  /barreras que impiden que su negocio crezca/,
  /presta servicio de domicilios/,
  /formas de pago digital acepta actualmente/,
  /acceso a alguno de los siguientes servicios financieros/,
  /mobiliario adicional cuenta su negocio/,
  /seleccione si hay disponibilidad de algunos de los siguientes productos/,
  /beneficios ha accedido en el tiempo vinculado a bavaria/,
];

/**
 * Cuál de las condiciones de la consulta hizo salir la fila. La pregunta
 * (componente_etiqueta) casi siempre lo dice sola; domicilios tiene dos
 * reglas y ahí decide el valor.
 *
 * Refleja los bloques del WHERE de lib/consultaAuditoria.ts: si la consulta
 * cambia, esto también.
 */
export function motivoAuditoria(etiqueta: string | null, valor: string | null): string {
  const e = sinTildes(etiqueta ?? "");
  const tieneSelect = /select/i.test(valor ?? "");

  if (e.trim() === "8.numero de identificacion") return MOTIVOS.cedula;
  if (e.includes("fecha de nacimiento de la persona duena del negocio")) return MOTIVOS.nacimiento;
  if (e.includes("presta servicio de domicilios")) {
    return tieneSelect ? MOTIVOS.select : MOTIVOS.domicilios;
  }
  if (tieneSelect && PREGUNTAS_SELECT.some((p) => p.test(e))) return MOTIVOS.select;
  if (e.includes("tiene el negocio actual") || e.includes("en este tipo de actividad comercial")) {
    return MOTIVOS.anos;
  }
  if (
    e.includes("porcentaje sobra para ahorrar o invertir") ||
    e.includes("porcentaje proviene de la venta de cerveza")
  ) {
    return MOTIVOS.porcentaje;
  }
  if (e.includes("valor total promedio de los costos y gastos de su negocio en un mes")) {
    return MOTIVOS.costos;
  }
  if (e.includes("ingreso total aproximado de ventas en un d")) return MOTIVOS.ventas;
  if (e.includes("edad del participante")) return MOTIVOS.edad;
  return MOTIVOS.otro;
}

/** Arma las filas a partir de lo que entrega Athena, buscando cada columna por nombre. */
export function filasDesdeAthena(
  columnas: string[],
  filas: (string | null)[][]
): FilaAuditoria[] {
  const posicion = new Map(columnas.map((c, i) => [c.toLowerCase(), i]));
  return filas.map((f) => {
    const fila = {} as FilaAuditoria;
    for (const c of COLUMNAS_AUDITORIA) {
      const i = posicion.get(c);
      fila[c] = i === undefined ? null : (f[i] ?? null);
    }
    // Con las tildes ya arregladas: "NÃºmero de identificaciÃ³n" también es la cédula.
    fila.motivo = motivoAuditoria(
      limpiarTexto(fila.componente_etiqueta),
      limpiarTexto(fila.componente_valor)
    );
    return fila;
  });
}
