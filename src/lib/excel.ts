import * as XLSX from "xlsx";
import type { PuntoCartera } from "./tipos";
import {
  aEntero,
  aFecha,
  aHora,
  aTexto,
  dentroDeColombia,
  LIMITE_LAT,
  LIMITE_LNG,
  normalizarCedula,
  normalizarCoordenada,
  normalizarUsuario,
} from "./normalizar";

/** Una fila leída: siempre trae id_pdv, y solo los campos que venían en el archivo. */
export type FilaCartera = Partial<PuntoCartera> & { id_pdv: string };

export type ModoCarga = "reemplazar" | "actualizar" | "agregar";

export type ResultadoLectura = {
  filas: FilaCartera[];
  total: number;
  descartadas: { fila: number; motivo: string }[];
  coordsCorregidas: number;
  sinCoordenadas: number;
  /** Campos de la base que sí venían en el archivo. */
  camposPresentes: string[];
  /** Encabezados del Excel que no se reconocieron. */
  columnasIgnoradas: string[];
  /** Si el archivo trae CICLO, el emparejamiento es exacto. */
  tieneCiclo: boolean;
};

type Tipo =
  | "texto"
  | "entero"
  | "fecha"
  | "hora"
  | "usuario"
  | "cedula"
  | "latitud"
  | "longitud";

/**
 * Mapa entre columnas del Excel y campos de la tabla. El primer nombre es el
 * de la plantilla; los demás son variantes vistas en archivos reales.
 */
const DEFINICIONES: {
  campo: keyof PuntoCartera;
  columnas: string[];
  tipo: Tipo;
  etiqueta: string;
}[] = [
  { campo: "bavaria", columnas: ["BAVARIA"], tipo: "texto", etiqueta: "Código Bavaria" },
  { campo: "pdv", columnas: ["PDV"], tipo: "texto", etiqueta: "Nombre del PDV" },
  { campo: "direccion", columnas: ["DIRECCION", "DIRECCIÓN"], tipo: "texto", etiqueta: "Dirección" },
  { campo: "persona_hacku", columnas: ["PERSONA HACKU"], tipo: "texto", etiqueta: "Persona de contacto" },
  { campo: "celular", columnas: ["CELULAR"], tipo: "texto", etiqueta: "Celular" },
  { campo: "que_hacer", columnas: ["QUE HACER", "QUÉ HACER"], tipo: "texto", etiqueta: "Tarea" },
  { campo: "fecha_nacimiento", columnas: ["FECHA_NACIMIENTO", "FECHA NACIMIENTO"], tipo: "fecha", etiqueta: "Fecha de nacimiento" },
  { campo: "departamento", columnas: ["DEPARTAMENTO"], tipo: "texto", etiqueta: "Departamento" },
  { campo: "ciudad", columnas: ["CIUDAD"], tipo: "texto", etiqueta: "Ciudad" },
  { campo: "estado_v1", columnas: ["ESTADO V1"], tipo: "texto", etiqueta: "Estado visita 1" },
  { campo: "fecha_v1", columnas: ["FECHA V1"], tipo: "fecha", etiqueta: "Fecha visita 1" },
  { campo: "hora_v1", columnas: ["HORA V1"], tipo: "hora", etiqueta: "Hora visita 1" },
  { campo: "usuario_v1", columnas: ["USUARIO V1"], tipo: "texto", etiqueta: "Usuario visita 1" },
  { campo: "hacku_estado", columnas: ["HACKU ESTADO"], tipo: "texto", etiqueta: "Hacku estado" },
  { campo: "hacku_curso", columnas: ["HACKU CURSO"], tipo: "texto", etiqueta: "Hacku curso" },
  { campo: "estado_v2", columnas: ["ESTADO V2"], tipo: "texto", etiqueta: "Estado visita 2" },
  { campo: "fecha_v2", columnas: ["FECHA V2"], tipo: "fecha", etiqueta: "Fecha visita 2" },
  { campo: "hora_v2", columnas: ["HORA V2"], tipo: "hora", etiqueta: "Hora visita 2" },
  { campo: "usuario_v2", columnas: ["USUSARIO V2", "USUARIO V2"], tipo: "texto", etiqueta: "Usuario visita 2" },
  { campo: "estado_v3", columnas: ["ESTADO V3"], tipo: "texto", etiqueta: "Estado visita 3" },
  { campo: "fecha_v3", columnas: ["FECHA V3"], tipo: "fecha", etiqueta: "Fecha visita 3" },
  { campo: "hora_v3", columnas: ["HORA V3"], tipo: "hora", etiqueta: "Hora visita 3" },
  { campo: "usuario_v3", columnas: ["USUARIO V3"], tipo: "texto", etiqueta: "Usuario visita 3" },
  { campo: "motivo", columnas: ["MOTIVO"], tipo: "texto", etiqueta: "Motivo" },
  { campo: "motivo_dueno", columnas: ["MOTIVO DUEÑO", "MOTIVO DUENO"], tipo: "texto", etiqueta: "Motivo dueño" },
  { campo: "comentario", columnas: ["COMENTARIO"], tipo: "texto", etiqueta: "Comentario" },
  { campo: "duracion_v1", columnas: ["DURACION V1", "DURACIÓN V1"], tipo: "texto", etiqueta: "Duración visita 1" },
  { campo: "ruta", columnas: ["RUTA"], tipo: "entero", etiqueta: "Ruta (color en el mapa)" },
  { campo: "latitud", columnas: ["LATITUD"], tipo: "latitud", etiqueta: "Latitud" },
  { campo: "longitud", columnas: ["LONGITUD"], tipo: "longitud", etiqueta: "Longitud" },
  { campo: "num_de_ruta", columnas: ["num de ruta", "NUM DE RUTA"], tipo: "entero", etiqueta: "Ruta del vendedor" },
  { campo: "persona", columnas: ["persona", "PERSONA"], tipo: "texto", etiqueta: "Persona" },
  { campo: "ccuser", columnas: ["ccuser", "CCUSER"], tipo: "cedula", etiqueta: "Cédula asignada" },
  { campo: "usuario", columnas: ["user", "USER", "USUARIO"], tipo: "usuario", etiqueta: "Usuario asignado" },
  { campo: "nom", columnas: ["nom", "NOM"], tipo: "texto", etiqueta: "Nombre del vendedor" },
];

const COLS_ID = ["ID"];
const COLS_CICLO = ["CICLO"];

function normalizarNombre(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_]+/g, "")
    .toLowerCase();
}

/** Resuelve el encabezado real del Excel para una lista de nombres posibles. */
function resolver(encabezados: string[], nombres: string[]): string | null {
  const mapa = new Map(encabezados.map((h) => [normalizarNombre(h), h]));
  for (const n of nombres) {
    const hallado = mapa.get(normalizarNombre(n));
    if (hallado) return hallado;
  }
  return null;
}

export function etiquetaDeCampo(campo: string): string {
  return DEFINICIONES.find((d) => d.campo === campo)?.etiqueta ?? campo;
}

export function leerPlantilla(buffer: ArrayBuffer): ResultadoLectura {
  const libro = XLSX.read(buffer, { type: "array", cellDates: true });

  const nombreHoja =
    libro.SheetNames.find((n) => {
      const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets[n], {
        range: 0,
      });
      return filas.length > 0 && resolver(Object.keys(filas[0] ?? {}), COLS_ID) !== null;
    }) ?? libro.SheetNames[0];

  const crudas = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    libro.Sheets[nombreHoja],
    // raw:true es deliberado: con raw:false SheetJS devuelve el texto ya
    // formateado de la celda y una latitud mostrada como "4,68" perdería
    // los decimales que necesita el mapa.
    { defval: null, raw: true }
  );

  if (crudas.length === 0) {
    return {
      filas: [],
      total: 0,
      descartadas: [],
      coordsCorregidas: 0,
      sinCoordenadas: 0,
      camposPresentes: [],
      columnasIgnoradas: [],
      tieneCiclo: false,
    };
  }

  const encabezados = Object.keys(crudas[0]);
  const colId = resolver(encabezados, COLS_ID);
  const colCiclo = resolver(encabezados, COLS_CICLO);

  if (!colId) {
    throw new Error(
      "El archivo no tiene columna ID. Sin ella no se puede identificar el punto."
    );
  }

  const activas = DEFINICIONES.map((d) => ({
    ...d,
    columna: resolver(encabezados, d.columnas),
  })).filter((d): d is typeof d & { columna: string } => d.columna !== null);

  const reconocidas = new Set<string>([colId, ...(colCiclo ? [colCiclo] : [])]);
  for (const a of activas) reconocidas.add(a.columna);
  const columnasIgnoradas = encabezados.filter(
    (h) => !reconocidas.has(h) && !h.startsWith("__EMPTY")
  );

  const traeCoords =
    activas.some((a) => a.campo === "latitud") &&
    activas.some((a) => a.campo === "longitud");

  const filas: FilaCartera[] = [];
  const descartadas: { fila: number; motivo: string }[] = [];
  let coordsCorregidas = 0;
  let sinCoordenadas = 0;

  crudas.forEach((f, i) => {
    const numeroFila = i + 2; // +1 encabezado, +1 base 1

    const idPdv = aTexto(f[colId]);
    if (!idPdv) {
      descartadas.push({ fila: numeroFila, motivo: "Sin ID de PDV" });
      return;
    }

    const fila: FilaCartera = { id_pdv: idPdv };
    if (colCiclo) fila.ciclo = aTexto(f[colCiclo]) ?? "";

    let corregida = false;

    for (const d of activas) {
      const bruto = f[d.columna];

      switch (d.tipo) {
        case "entero":
          (fila as Record<string, unknown>)[d.campo] = aEntero(bruto);
          break;
        case "fecha":
          (fila as Record<string, unknown>)[d.campo] = aFecha(bruto);
          break;
        case "hora":
          (fila as Record<string, unknown>)[d.campo] = aHora(bruto);
          break;
        case "usuario":
          (fila as Record<string, unknown>)[d.campo] = normalizarUsuario(bruto);
          break;
        case "cedula":
          (fila as Record<string, unknown>)[d.campo] = normalizarCedula(bruto);
          break;
        case "latitud": {
          const [v, c] = normalizarCoordenada(bruto, LIMITE_LAT);
          fila.latitud = v;
          corregida = corregida || c;
          break;
        }
        case "longitud": {
          const [v, c] = normalizarCoordenada(bruto, LIMITE_LNG);
          fila.longitud = v;
          corregida = corregida || c;
          break;
        }
        default:
          (fila as Record<string, unknown>)[d.campo] = aTexto(bruto);
      }
    }

    if (traeCoords) {
      const { latitud, longitud } = fila;
      if (
        typeof latitud === "number" &&
        typeof longitud === "number" &&
        !dentroDeColombia(latitud, longitud)
      ) {
        descartadas.push({
          fila: numeroFila,
          motivo: `Coordenada fuera de Colombia (${latitud}, ${longitud}); el punto se guarda sin ubicación`,
        });
        fila.latitud = null;
        fila.longitud = null;
      }

      // Se asigna SIEMPRE, no solo cuando hubo corrección: PostgREST arma el
      // INSERT con la unión de las claves de todas las filas del lote y rellena
      // con null las que no traen la clave. Si solo las filas corregidas la
      // llevaran, el resto del lote intentaría escribir null en una columna
      // not null y Supabase rechazaría el lote completo.
      fila.coord_corregida = corregida;

      if (fila.latitud === null || fila.longitud === null) sinCoordenadas++;
      else if (corregida) coordsCorregidas++;
    }

    filas.push(fila);
  });

  return {
    filas,
    total: crudas.length,
    descartadas,
    coordsCorregidas,
    sinCoordenadas,
    camposPresentes: activas.map((a) => a.campo as string),
    columnasIgnoradas,
    tieneCiclo: colCiclo !== null,
  };
}

/**
 * Descarga de la cartera del vendedor: exclusivamente las columnas A-G,
 * en el mismo orden y con los mismos encabezados de la plantilla original.
 */
export function exportarCartera(puntos: PuntoCartera[], usuario: string) {
  const datos = puntos.map((p) => ({
    ID: p.id_pdv ?? "",
    BAVARIA: p.bavaria ?? "",
    PDV: p.pdv ?? "",
    DIRECCION: p.direccion ?? "",
    "PERSONA HACKU": p.persona_hacku ?? "",
    CELULAR: p.celular ?? "",
    "QUE HACER": p.que_hacer ?? "",
  }));

  const hoja = XLSX.utils.json_to_sheet(datos, {
    header: ["ID", "BAVARIA", "PDV", "DIRECCION", "PERSONA HACKU", "CELULAR", "QUE HACER"],
  });

  hoja["!cols"] = [
    { wch: 10 },
    { wch: 12 },
    { wch: 38 },
    { wch: 42 },
    { wch: 28 },
    { wch: 16 },
    { wch: 16 },
  ];

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Mi cartera");

  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(libro, `Cartera_${usuario}_${fecha}.xlsx`);
}
