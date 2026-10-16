"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  Copy,
  ChevronRight,
  ExternalLink,
  ImageOff,
  Maximize2,
  FolderDown,
  Sheet,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  SIN_RANGO,
  dentroDelRango,
  diaCorto,
  diaLargo,
  hayRango,
  rangoAlReves,
  resumirFechas,
  sufijoRango,
  textoRango,
  cuando,
  type Rango,
} from "@/lib/fechas";
import { limpiarTexto } from "@/lib/limpiadorAuditoria";
import type { EstadoFoto, EstadoRevision, FilaImagen, Revision } from "@/lib/imagenesAuditoria";
import EncabezadoPagina from "./EncabezadoPagina";
import FiltrosActivos, { type FiltroActivo } from "./FiltrosActivos";
import RangoFechas from "./RangoFechas";
import type { FiltroColumna } from "@/lib/fotosQuery";
import type { Grupo } from "@/lib/repetidas";
import { cifra, sinTildes, type Fase } from "./ConsultaAthena";
import { ENCABEZADO_VISITAS, fotosDeVisitas, ProgresoDescargaFotos, useDescargaFotos } from "./DescargaFotos";
import PanelRepetidas, { EncabezadoGrupo } from "./PanelRepetidas";
import { useRepetidas } from "./useRepetidas";
import PanelEtiquetas, { ILEGIBLES, NINGUNA, SIN_REVISAR, type CuentasIA } from "./PanelEtiquetas";
import { useEtiquetasIA, type Visto } from "./useEtiquetasIA";

/**
 * La pantalla de revisar fotos: filtros, galería por día, la visita elegida a
 * la derecha, el visor en grande, las marcas Correcta / Para revisar y el
 * Excel. La comparten la Auditoría de imágenes (su consulta fija) y la
 * Auditoría con query (la query que se escriba). Cada una trae sus filas ya
 * ordenadas, su encabezado y su Excel.
 *
 * Cuando cambian las filas (otra consulta, u otras columnas en la de query)
 * se limpian los filtros.
 */

/** Las fotos llegan en su tamaño original, así que se muestran de a pocas. */
const POR_PAGINA = 24;

/** "rota": tiene enlace pero la foto no cargó en este navegador. */
type FiltroFoto = "todas" | EstadoFoto | "rota";
type FiltroRevision = "" | "sin" | EstadoRevision;

/** Una foto de la galería: la visita a la que pertenece y cuál de sus fotos es. */
type Foto = { fila: FilaImagen; url: string; numero: number; de: number };

const pdvDe = (f: FilaImagen) => limpiarTexto(f.nombre_pdv) ?? "PDV sin nombre";
const usuarioDe = (f: FilaImagen) => limpiarTexto(f.nombre_usuario) ?? "Sin consultor";

/** '12/09/2026 14:05', o lo que traiga la columna si no se entiende como fecha. */
const fechaDe = (f: FilaImagen) =>
  f.dia ? `${diaCorto(f.dia)}${f.hora ? ` ${f.hora}` : ""}` : limpiarTexto(f.fecha_inicio);

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** En pantallas grandes la foto se abre en el panel de la derecha; en el celular, a pantalla completa. */
const conPanel = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;

type Props<F extends FilaImagen> = {
  /** Prefijo de los id de la pantalla: «imagenes», «query». */
  prefijo: string;
  titulo: string;
  descripcion: string;
  /** Botones del encabezado, antes del de descargar. */
  acciones?: ReactNode;
  /** Lo que va debajo del encabezado: el avance de la consulta, el editor… */
  arriba?: ReactNode;
  fase: Fase;
  /** De la visita más reciente a la más antigua: así salen en la galería y en el Excel. */
  filas: F[];
  /** Qué decir cuando la consulta terminó sin filas. */
  vacio: string;
  /** Cómo se llama la columna de fecha, para el selector de fechas. */
  columnaFecha: string;
  /** Rótulo de la fecha en la visita elegida: «Inicio», «Fecha». */
  nombreFecha: string;
  /** Qué es la foto, para el texto alternativo: «Foto de inicio de visita». */
  queFoto: string;
  exportar: (
    filas: F[],
    sufijo: string,
    revisionDe: (f: F) => Revision | null,
    repetidaDe?: (f: F) => { grupo: number; ia: string | null } | null,
    vistoDe?: (f: F) => string | null
  ) => void;
  /** Datos de más para la visita elegida (las otras columnas de una query). */
  detalle?: (f: F) => [string, string][];
  /** Filtros con los valores de otras columnas (departamento, zona…). */
  filtrosColumna?: FiltroColumna<F>[];
  /** Buscar fotos repetidas y confirmarlas con IA. */
  repetidas?: boolean;
  /** Que la IA diga qué se ve en las fotos (libro, afiche…) para filtrar por eso. */
  etiquetasIA?: boolean;
  /** Con qué nombre sale el ZIP de las fotos (se le agregan las fechas). */
  nombreFotos: string;
};

/** El valor del filtro de columna para las visitas que no traen dato. */
const SIN_DATO = "\u0000sin-dato";

/** Cómo va una visita en los grupos de repetidas: su grupo y qué dijo la IA. */
type Repetida = { numero: number; visitas: number; ia: boolean | null; motivo: string | null };

export default function GaleriaFotos<F extends FilaImagen>({
  prefijo,
  titulo,
  descripcion,
  acciones,
  arriba,
  fase,
  filas,
  vacio,
  columnaFecha,
  nombreFecha,
  queFoto,
  exportar,
  detalle,
  filtrosColumna,
  repetidas = false,
  etiquetasIA = false,
  nombreFotos,
}: Props<F>) {

  /** Rango de fechas: delimita la galería, los conteos y el Excel. */
  const [rango, setRango] = useState<Rango>(SIN_RANGO);
  const [consultor, setConsultor] = useState("");
  const [filtro, setFiltro] = useState<FiltroFoto>("todas");
  const [revisionFiltro, setRevisionFiltro] = useState<FiltroRevision>("");
  const [busqueda, setBusqueda] = useState("");
  const [visibles, setVisibles] = useState(POR_PAGINA);
  const [rotas, setRotas] = useState<Set<string>>(() => new Set());
  const [abierta, setAbierta] = useState<number | null>(null);
  const [elegida, setElegida] = useState<F | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [masFiltros, setMasFiltros] = useState(false);
  /** Valor elegido en cada filtro de columna (por su id); vacío es «Todos». */
  const [valoresColumna, setValoresColumna] = useState<Record<string, string>>({});
  const [soloRepetidas, setSoloRepetidas] = useState(false);
  /** Lo que vio la IA: una etiqueta, NINGUNA, ILEGIBLES o SIN_REVISAR; vacío es todas. */
  const [vistoFiltro, setVistoFiltro] = useState("");

  // ------------------------------------------------------------ revisiones
  const [revisiones, setRevisiones] = useState<Map<string, Revision>>(() => new Map());
  const [avisoRevision, setAvisoRevision] = useState<string | null>(null);
  const [puedeMarcar, setPuedeMarcar] = useState(false);

  useEffect(() => {
    fetch("/api/admin/revision-fotos")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? "No se pudieron leer las revisiones.");
        const mapa = new Map<string, Revision>();
        for (const x of j.revisiones ?? []) {
          mapa.set(x.clave, { estado: x.estado, revisado_por: x.revisado_por, actualizado: x.actualizado });
        }
        setRevisiones(mapa);
        setAvisoRevision(j.aviso ?? null);
        setPuedeMarcar(!j.aviso);
      })
      .catch((e) => setAvisoRevision((e as Error).message));
  }, []);

  const revisionDe = useCallback(
    (f: FilaImagen): Revision | null => (f.clave ? (revisiones.get(f.clave) ?? null) : null),
    [revisiones]
  );

  async function marcar(f: FilaImagen, estado: EstadoRevision | null) {
    if (!f.clave) return;
    const clave = f.clave;
    const previa = revisiones.get(clave) ?? null;
    const cambiar = (r: Revision | null) =>
      setRevisiones((m) => {
        const nuevo = new Map(m);
        if (r) nuevo.set(clave, r);
        else nuevo.delete(clave);
        return nuevo;
      });

    // Se ve al instante; si el servidor no lo guarda, vuelve como estaba.
    cambiar(estado ? { estado, revisado_por: null, actualizado: new Date().toISOString() } : null);
    try {
      const r = await fetch("/api/admin/revision-fotos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clave,
          estado,
          cod: f.cod_personalizado,
          usuario: f.nombre_usuario,
          fecha: f.fecha_inicio,
          foto: f.fotos[0] ?? f.foto_visita_inicio,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar la marca.");
      cambiar(j.revision ?? null);
    } catch (e) {
      cambiar(previa);
      setAviso((e as Error).message);
    }
  }

  // Filas nuevas (otra consulta): se limpian los filtros de la anterior.
  const filasAntes = useRef(filas);
  useEffect(() => {
    if (filasAntes.current === filas) return;
    filasAntes.current = filas;
    setRango(SIN_RANGO);
    setConsultor("");
    setFiltro("todas");
    setRevisionFiltro("");
    setBusqueda("");
    setVisibles(POR_PAGINA);
    setRotas(new Set());
    setAbierta(null);
    setElegida(null);
    setAviso(null);
    setValoresColumna({});
    setSoloRepetidas(false);
    setVistoFiltro("");
  }, [filas]);

  const marcarRota = useCallback((url: string) => {
    setRotas((previas) => (previas.has(url) ? previas : new Set(previas).add(url)));
  }, []);

  function alFiltrar<T>(cambiar: (valor: T) => void) {
    return (valor: T) => {
      cambiar(valor);
      setVisibles(POR_PAGINA);
      setAbierta(null);
    };
  }

  // ------------------------------------------------------------ derivados
  /** Entre qué días hay visitas y cuántas no traen fecha. */
  const fechas = useMemo(
    () => resumirFechas(filas, (f) => f.dia, (f) => f.fecha_inicio),
    [filas]
  );

  const conRango = hayRango(rango);
  const alReves = rangoAlReves(rango);

  /** Las visitas del rango de fechas. Una visita sin fecha no entra en ningún rango. */
  const enRango = useMemo(
    () => (conRango ? filas.filter((f) => dentroDelRango(f.dia, rango)) : filas),
    [filas, conRango, rango]
  );

  const esRota = useCallback((f: FilaImagen) => f.fotos.length > 0 && rotas.has(f.fotos[0]), [rotas]);

  // Las repetidas se buscan entre las visitas de las fechas elegidas.
  const rep = useRepetidas(repetidas, enRango);
  const eti = useEtiquetasIA(etiquetasIA);
  const { vistoDe } = eti;

  /** Cuántas visitas de las fechas tienen cada cosa que vio la IA. */
  const cuentasIA = useMemo((): CuentasIA => {
    const porEtiqueta = new Map(eti.etiquetas.map((e) => [e, 0]));
    let ninguna = 0;
    let ilegibles = 0;
    let sinRevisar = 0;
    if (etiquetasIA) {
      for (const f of enRango) {
        const v = vistoDe(f);
        if (!v) continue;
        if (!v.revisada) {
          sinRevisar++;
          continue;
        }
        for (const e of v.ve) porEtiqueta.set(e, (porEtiqueta.get(e) ?? 0) + 1);
        if (v.ilegible) ilegibles++;
        else if (v.ve.length === 0) ninguna++;
      }
    }
    return { porEtiqueta: [...porEtiqueta.entries()], ninguna, ilegibles, sinRevisar };
  }, [etiquetasIA, enRango, vistoDe, eti.etiquetas]);
  const { reiniciar: reiniciarRepetidas, grupoDe, resumenIA, veredictoDe } = rep;
  const filasRepetidas = useRef(filas);
  useEffect(() => {
    if (filasRepetidas.current === filas) return;
    filasRepetidas.current = filas;
    reiniciarRepetidas();
  }, [filas, reiniciarRepetidas]);

  const repetidaDe = useCallback(
    (f: F): Repetida | null => {
      const g = grupoDe.get(f);
      if (!g) return null;
      if (f === g.visitas[0]) {
        const r = resumenIA(g);
        return {
          numero: g.numero,
          visitas: g.visitas.length,
          ia: r.mismas > 0 ? true : r.total > 0 && r.revisadas === r.total ? false : null,
          motivo: null,
        };
      }
      const v = veredictoDe(g, f);
      return { numero: g.numero, visitas: g.visitas.length, ia: v ? v.misma : null, motivo: v?.motivo || null };
    },
    [grupoDe, resumenIA, veredictoDe]
  );

  /** Los valores de cada filtro de columna: de toda la consulta, con cuántas visitas hay en las fechas. */
  const columnasFiltro = useMemo(
    () =>
      (filtrosColumna ?? []).map((fc) => {
        const cuenta = new Map<string, number>();
        let vacios = 0;
        for (const f of filas) {
          const v = fc.valorDe(f);
          if (v !== null && !cuenta.has(v)) cuenta.set(v, 0);
        }
        for (const f of enRango) {
          const v = fc.valorDe(f);
          if (v === null) vacios++;
          else cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
        }
        return { ...fc, valores: [...cuenta.entries()].sort((a, b) => a[0].localeCompare(b[0], "es")), vacios };
      }),
    [filtrosColumna, filas, enRango]
  );

  // Los conteos son de las fechas elegidas; la lista de consultores, de toda la consulta.
  const cuentas = useMemo(() => {
    const porEstado: Record<EstadoFoto, number> = { con_foto: 0, sin_foto: 0, no_es_enlace: 0 };
    const porRevision = { sin: 0, correcta: 0, revisar: 0 };
    const porConsultor = new Map<string, number>();
    let conRotas = 0;
    for (const f of filas) porConsultor.set(usuarioDe(f), 0);
    for (const f of enRango) {
      porEstado[f.estado]++;
      if (esRota(f)) conRotas++;
      const u = usuarioDe(f);
      porConsultor.set(u, (porConsultor.get(u) ?? 0) + 1);
      if (f.estado === "con_foto") {
        const r = revisionDe(f);
        porRevision[r ? r.estado : "sin"]++;
      }
    }
    return {
      porEstado,
      porRevision,
      rotas: conRotas,
      consultores: [...porConsultor.entries()].sort((a, b) => a[0].localeCompare(b[0], "es")),
    };
  }, [filas, enRango, esRota, revisionDe]);

  const indice = useMemo(
    () =>
      new Map(
        filas.map((f) => [
          f,
          sinTildes([pdvDe(f), f.cod_personalizado, usuarioDe(f)].filter(Boolean).join(" ")),
        ])
      ),
    [filas]
  );

  const filtradas = useMemo(() => {
    const q = sinTildes(busqueda.trim());
    const lista = enRango.filter((f) => {
      if (consultor && usuarioDe(f) !== consultor) return false;
      if (filtro === "rota" ? !esRota(f) : filtro !== "todas" && f.estado !== filtro) return false;
      if (revisionFiltro) {
        if (f.estado !== "con_foto") return false;
        const r = revisionDe(f);
        if (revisionFiltro === "sin" ? r !== null : r?.estado !== revisionFiltro) return false;
      }
      for (const fc of filtrosColumna ?? []) {
        const elegido = valoresColumna[fc.id];
        if (!elegido) continue;
        const v = fc.valorDe(f);
        if (elegido === SIN_DATO ? v !== null : v !== elegido) return false;
      }
      if (soloRepetidas && !grupoDe.has(f)) return false;
      if (vistoFiltro && !cumpleVisto(vistoDe(f), vistoFiltro)) return false;
      return !q || (indice.get(f) ?? "").includes(q);
    });
    // Las repetidas se ven por grupo, en el orden del grupo.
    if (soloRepetidas) {
      lista.sort((a, b) => {
        const ga = grupoDe.get(a)!;
        const gb = grupoDe.get(b)!;
        return ga.numero - gb.numero || ga.visitas.indexOf(a) - gb.visitas.indexOf(b);
      });
    }
    return lista;
  }, [enRango, consultor, filtro, revisionFiltro, busqueda, indice, esRota, revisionDe, filtrosColumna, valoresColumna, soloRepetidas, grupoDe, vistoFiltro, vistoDe]);

  /** Fotos de las visitas filtradas que la IA todavía no ha revisado. */
  const { pendientesDe } = eti;
  const pendientesIA = useMemo(() => (etiquetasIA ? pendientesDe(filtradas).length : 0), [etiquetasIA, pendientesDe, filtradas]);

  /** Posición de cada visita en la lista: llave estable para la galería. */
  const numero = useMemo(() => new Map(filas.map((f, i) => [f, i])), [filas]);

  /** Todas las fotos del filtro, en orden: por ellas se pasa en el visor. */
  const fotos = useMemo(() => {
    const lista: Foto[] = [];
    const primera = new Map<FilaImagen, number>();
    for (const fila of filtradas) {
      if (fila.fotos.length > 0) primera.set(fila, lista.length);
      fila.fotos.forEach((url, i) => lista.push({ fila, url, numero: i + 1, de: fila.fotos.length }));
    }
    return { lista, primera };
  }, [filtradas]);

  /** Las visitas con foto del filtro: por ellas se pasa en el panel de la derecha. */
  const conFoto = useMemo(() => filtradas.filter((f) => f.fotos.length > 0), [filtradas]);

  // El panel muestra siempre una visita del filtro: la elegida o la primera.
  const actual = elegida && conFoto.includes(elegida) ? elegida : (conFoto[0] ?? null);
  const posActual = actual ? conFoto.indexOf(actual) : -1;

  /**
   * La galería por día (cabecera con el día y cuántas visitas tiene en el
   * filtro) o, viendo solo repetidas, por grupo.
   */
  const dias = useMemo(() => {
    const clave = (f: F) => (soloRepetidas ? `g${grupoDe.get(f)?.numero}` : (f.dia ?? ""));
    const total = new Map<string, number>();
    for (const f of filtradas) total.set(clave(f), (total.get(clave(f)) ?? 0) + 1);
    const bloques: { clave: string; dia: string; grupo: Grupo<F> | null; visitas: F[] }[] = [];
    for (const f of filtradas.slice(0, visibles)) {
      const c = clave(f);
      const ultimo = bloques[bloques.length - 1];
      if (ultimo && ultimo.clave === c) ultimo.visitas.push(f);
      else bloques.push({ clave: c, dia: f.dia ?? "", grupo: soloRepetidas ? (grupoDe.get(f) ?? null) : null, visitas: [f] });
    }
    return bloques.map((g) => ({ ...g, total: total.get(g.clave) ?? g.visitas.length }));
  }, [filtradas, visibles, soloRepetidas, grupoDe]);

  function abrir(f: F) {
    if (conPanel()) setElegida(f);
    else setAbierta(fotos.primera.get(f) ?? null);
  }

  /** El Excel trae lo que se ve: las visitas que quedan con todos los filtros, en ese orden. */
  function descargar() {
    try {
      exportar(
        filtradas,
        sufijoRango(rango),
        revisionDe,
        rep.buscado
          ? (f) => {
              const r = repetidaDe(f);
              return r ? { grupo: r.numero, ia: r.ia === null ? null : r.ia ? "Misma foto" : "Foto distinta" } : null;
            }
          : undefined,
        etiquetasIA
          ? (f) => {
              const v = vistoDe(f);
              return v?.revisada ? textoVisto(v) : null;
            }
          : undefined
      );
    } catch {
      setAviso("No se pudo armar el Excel. Intenta de nuevo.");
    }
  }

  // ------------------------------------------------------------ filtros puestos
  const puestos: FiltroActivo[] = [];
  if (conRango) {
    puestos.push({
      id: "fechas",
      etiqueta: alReves ? "Fechas al revés" : mayuscula(textoRango(rango)),
      quitar: () => alFiltrar(setRango)(SIN_RANGO),
    });
  }
  if (consultor) puestos.push({ id: "consultor", etiqueta: `Consultor: ${consultor}`, quitar: () => alFiltrar(setConsultor)("") });
  if (filtro !== "todas") {
    const nombres: Record<FiltroFoto, string> = {
      todas: "",
      con_foto: "Con foto",
      sin_foto: "Sin foto",
      no_es_enlace: "Sin enlace válido",
      rota: "No cargó",
    };
    puestos.push({ id: "foto", etiqueta: nombres[filtro], quitar: () => alFiltrar(setFiltro)("todas") });
  }
  if (revisionFiltro) {
    const nombres = { sin: "Sin revisar", correcta: "Correctas", revisar: "Para revisar" };
    puestos.push({ id: "revision", etiqueta: nombres[revisionFiltro], quitar: () => alFiltrar(setRevisionFiltro)("") });
  }
  if (busqueda.trim()) puestos.push({ id: "busqueda", etiqueta: `«${busqueda.trim()}»`, quitar: () => alFiltrar(setBusqueda)("") });
  for (const fc of filtrosColumna ?? []) {
    const v = valoresColumna[fc.id];
    if (!v) continue;
    puestos.push({
      id: `columna-${fc.id}`,
      etiqueta: `${fc.nombre}: ${v === SIN_DATO ? "sin dato" : v}`,
      quitar: () => alFiltrar(setValoresColumna)({ ...valoresColumna, [fc.id]: "" }),
    });
  }
  if (soloRepetidas) puestos.push({ id: "repetidas", etiqueta: "Solo repetidas", quitar: () => alFiltrar(setSoloRepetidas)(false) });
  if (vistoFiltro) {
    const nombre =
      vistoFiltro === NINGUNA ? "ninguna de la lista" : vistoFiltro === ILEGIBLES ? "ilegible" : vistoFiltro === SIN_REVISAR ? "sin revisar" : vistoFiltro;
    puestos.push({ id: "visto", etiqueta: `IA: ${nombre}`, quitar: () => alFiltrar(setVistoFiltro)("") });
  }

  function quitarTodo() {
    setRango(SIN_RANGO);
    setConsultor("");
    setFiltro("todas");
    setRevisionFiltro("");
    setBusqueda("");
    setValoresColumna({});
    setSoloRepetidas(false);
    setVistoFiltro("");
    setVisibles(POR_PAGINA);
    setAbierta(null);
  }

  const chips: { id: FiltroFoto; nombre: string; n: number }[] = [
    { id: "todas", nombre: "Todas", n: enRango.length },
    { id: "con_foto", nombre: "Con foto", n: cuentas.porEstado.con_foto },
    { id: "sin_foto", nombre: "Sin foto", n: cuentas.porEstado.sin_foto },
    // Solo aparecen si hay casos así: lo normal es que no los haya.
    ...(cuentas.porEstado.no_es_enlace > 0
      ? [{ id: "no_es_enlace" as const, nombre: "Sin enlace válido", n: cuentas.porEstado.no_es_enlace }]
      : []),
    ...(cuentas.rotas > 0 || filtro === "rota"
      ? [{ id: "rota" as const, nombre: "No cargó", n: cuentas.rotas }]
      : []),
  ];

  const revisadas = cuentas.porRevision.correcta + cuentas.porRevision.revisar;
  const otrosFiltros = [
    consultor,
    busqueda.trim(),
    revisionFiltro,
    filtro !== "todas" ? "x" : "",
    soloRepetidas ? "x" : "",
    vistoFiltro,
    ...Object.values(valoresColumna),
  ].filter(Boolean).length;
  const listo = fase.tipo === "listo" && filas.length > 0;

  // ------------------------------------------------------------ fotos en ZIP
  const zip = useDescargaFotos();
  const fotosFiltradas = useMemo(() => filtradas.reduce((n, f) => n + f.fotos.length, 0), [filtradas]);
  const bajandoZip = zip.estado.tipo === "bajando";
  function descargarFotos() {
    zip.descargar(fotosDeVisitas(filtradas, revisionDe), `${nombreFotos}_${sufijoRango(rango)}`, ENCABEZADO_VISITAS);
  }

  // ------------------------------------------------------------ pantalla
  return (
    <div className="space-y-5">
      <EncabezadoPagina
        titulo={titulo}
        descripcion={descripcion}
        acciones={
          <>
            {acciones}
            {listo && (
              <button
                type="button"
                onClick={descargarFotos}
                disabled={fotosFiltradas === 0 || bajandoZip}
                title="Las fotos que ves, en un ZIP con carpetas por ciclo"
                className="boton boton-secundario"
              >
                <FolderDown size={16} aria-hidden />
                Descargar fotos
                <span className="cifras font-normal">({cifra(fotosFiltradas)})</span>
              </button>
            )}
            {listo && (
              <button
                type="button"
                onClick={descargar}
                disabled={filtradas.length === 0}
                className="boton boton-ambar"
              >
                <Sheet size={16} aria-hidden />
                Descargar Excel
                <span className="cifras font-normal">({cifra(filtradas.length)})</span>
              </button>
            )}
          </>
        }
      />

      {arriba}

      <ProgresoDescargaFotos estado={zip.estado} onDetener={zip.detener} onCerrar={zip.cerrar} />

      {aviso && (
        <p className="flex items-center gap-2 rounded-[4px] bg-[var(--color-aviso-fondo)] px-3 py-2.5 text-[13px] text-[var(--color-aviso-tinta)]">
          <TriangleAlert size={14} className="shrink-0" aria-hidden />
          <span className="flex-1">{aviso}</span>
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar el aviso" className="shrink-0">
            <X size={14} aria-hidden />
          </button>
        </p>
      )}

      {fase.tipo === "listo" && filas.length === 0 && vacio && (
        <p className="rounded-[4px] border border-dashed border-[var(--color-linea)] px-4 py-6 text-center text-[13px] text-[var(--color-tinta-suave)]">
          {vacio}
        </p>
      )}

      {listo && (
        <>
          {/* ---------------------------------------------------------- filtros */}
          <section aria-label="Filtros" id={`${prefijo}-filtros`} className="tarjeta scroll-mt-20 space-y-4 px-4 py-4 sm:px-5">
            <RangoFechas
              id={prefijo}
              rango={rango}
              onCambiar={alFiltrar(setRango)}
              fechas={fechas}
              uno="visita"
              varios="visitas"
              femenino
              columna={columnaFecha}
            />

            <div className={`${masFiltros ? "grid" : "hidden"} gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr]`}>
              <div>
                <label htmlFor={`${prefijo}-consultor`} className="campo-etiqueta">
                  Consultor
                </label>
                <select
                  id={`${prefijo}-consultor`}
                  value={consultor}
                  onChange={(e) => alFiltrar(setConsultor)(e.target.value)}
                  className="campo"
                >
                  <option value="">Todos los consultores</option>
                  {cuentas.consultores.map(([u, n]) => (
                    <option key={u} value={u}>
                      {u} ({cifra(n)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${prefijo}-revision`} className="campo-etiqueta">
                  Revisión
                </label>
                <select
                  id={`${prefijo}-revision`}
                  value={revisionFiltro}
                  onChange={(e) => alFiltrar(setRevisionFiltro)(e.target.value as FiltroRevision)}
                  className="campo"
                >
                  <option value="">Todas</option>
                  <option value="sin">Sin revisar ({cifra(cuentas.porRevision.sin)})</option>
                  <option value="correcta">Correctas ({cifra(cuentas.porRevision.correcta)})</option>
                  <option value="revisar">Para revisar ({cifra(cuentas.porRevision.revisar)})</option>
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <label htmlFor={`${prefijo}-buscar`} className="campo-etiqueta">
                  Buscar
                </label>
                <input
                  id={`${prefijo}-buscar`}
                  type="search"
                  value={busqueda}
                  onChange={(e) => alFiltrar(setBusqueda)(e.target.value)}
                  placeholder="PDV o código"
                  className="campo"
                />
              </div>
            </div>

            {columnasFiltro.length > 0 && (
              <div className={`${masFiltros ? "grid" : "hidden"} gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4`}>
                {columnasFiltro.map((fc, i) => (
                  <div key={fc.id}>
                    <label htmlFor={`${prefijo}-columna-${i}`} className="campo-etiqueta">
                      {fc.nombre}
                    </label>
                    <select
                      id={`${prefijo}-columna-${i}`}
                      value={valoresColumna[fc.id] ?? ""}
                      onChange={(e) => alFiltrar(setValoresColumna)({ ...valoresColumna, [fc.id]: e.target.value })}
                      className="campo"
                    >
                      <option value="">Todos</option>
                      {fc.valores.map(([v, n]) => (
                        <option key={v} value={v}>
                          {v} ({cifra(n)})
                        </option>
                      ))}
                      {fc.vacios > 0 && <option value={SIN_DATO}>Sin dato ({cifra(fc.vacios)})</option>}
                    </select>
                  </div>
                ))}
              </div>
            )}

            <div
              role="group"
              aria-label="Estado de la foto"
              className={`${masFiltros ? "flex" : "hidden"} flex-wrap gap-1.5 sm:flex`}
            >
              {chips.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={filtro === c.id}
                  onClick={() => alFiltrar(setFiltro)(c.id)}
                  className="chip"
                >
                  {c.nombre}
                  <span className="cifras opacity-75">{cifra(c.n)}</span>
                </button>
              ))}
            </div>

            {repetidas && (
              <PanelRepetidas r={rep} soloRepetidas={soloRepetidas} onSoloRepetidas={alFiltrar(setSoloRepetidas)} />
            )}

            {etiquetasIA && (
              <PanelEtiquetas
                e={eti}
                pendientes={pendientesIA}
                cuentas={cuentasIA}
                filtro={vistoFiltro}
                onFiltro={alFiltrar(setVistoFiltro)}
                onRevisar={() => eti.revisar(filtradas)}
              />
            )}

            <FiltrosActivos
              filtros={puestos}
              onQuitarTodo={quitarTodo}
              nota={
                filtradas.length === 0
                  ? "No hay visitas con estos filtros para descargar."
                  : `El Excel trae ${
                      filtradas.length === 1 ? "la visita" : `las ${cifra(filtradas.length)} visitas`
                    } que ves${filtradas.length === enRango.length && !conRango ? "" : " con estos filtros"}, con su revisión.`
              }
            />
          </section>

          {avisoRevision && (
            <p className="flex items-start gap-2 rounded-[4px] bg-[var(--color-relleno)] px-3 py-2.5 text-[13px] leading-snug">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
              {avisoRevision}
            </p>
          )}

          {cuentas.rotas > 0 && (
            <p className="flex items-start gap-2 rounded-[4px] bg-[var(--color-aviso-fondo)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-aviso-tinta)]">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
              {cuentas.rotas === 1 ? "1 foto no cargó." : `${cifra(cuentas.rotas)} fotos no cargaron.`} Puede que
              el enlace ya no exista o que el servidor de fotos no deje verlas desde esta página.
            </p>
          )}

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* ---------------------------------------------------------- galería */}
            <section aria-label="Fotos por día" className="min-w-0 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="cifras text-[14px]">
                  <b className="font-semibold">
                    {cifra(filtradas.length)} {filtradas.length === 1 ? "visita" : "visitas"}
                  </b>
                  {filtradas.length !== enRango.length && (
                    <span className="text-[var(--color-tinta-suave)]"> de {cifra(enRango.length)}</span>
                  )}
                </p>
                {cuentas.porEstado.con_foto > 0 && (
                  <div className="flex items-center gap-2.5 text-[13px] text-[var(--color-tinta-suave)]">
                    <span className="cifras">
                      Revisadas {cifra(revisadas)} de {cifra(cuentas.porEstado.con_foto)}
                    </span>
                    <span className="h-1.5 w-28 overflow-hidden rounded-full bg-[var(--color-relleno)]" aria-hidden>
                      <span
                        className="block h-full bg-[var(--color-exito)]"
                        style={{ width: `${(revisadas / cuentas.porEstado.con_foto) * 100}%` }}
                      />
                    </span>
                  </div>
                )}
              </div>

              {filtradas.length === 0 ? (
                <p className="rounded-[4px] border border-dashed border-[var(--color-linea)] px-4 py-6 text-center text-[13px] text-[var(--color-tinta-suave)]">
                  {enRango.length === 0
                    ? "No hay visitas en esas fechas."
                    : "Ninguna visita coincide con esos filtros."}
                </p>
              ) : (
                dias.map((g) => (
                  <div key={g.clave || "sin-fecha"} className="space-y-2.5">
                    {g.grupo ? (
                      <EncabezadoGrupo
                        grupo={g.grupo}
                        resumen={resumenIA(g.grupo)}
                        enFiltro={g.total}
                        confirmando={rep.confirmando !== null}
                        onConfirmar={() => rep.confirmar([g.grupo!])}
                      />
                    ) : (
                      <h2 className="flex items-baseline gap-2 text-[15px] font-semibold">
                        {g.dia ? diaLargo(g.dia) : "Sin fecha"}
                        <span className="cifras text-[13px] font-normal text-[var(--color-tinta-suave)]">
                          {cifra(g.total)} {g.total === 1 ? "visita" : "visitas"}
                        </span>
                      </h2>
                    )}
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                      {g.visitas.map((f) => (
                        <li key={numero.get(f)}>
                          <Tarjeta
                            fila={f}
                            elegida={actual === f}
                            repetida={repetidaDe(f)}
                            revision={revisionDe(f)}
                            rota={esRota(f)}
                            onRota={marcarRota}
                            onAbrir={() => abrir(f)}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}

              {filtradas.length > visibles && (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setVisibles((v) => v + POR_PAGINA)}
                    className="boton boton-secundario"
                  >
                    Mostrar {cifra(Math.min(POR_PAGINA, filtradas.length - visibles))} más
                    <span className="cifras font-normal text-[var(--color-tinta-suave)]">
                      ({cifra(visibles)} de {cifra(filtradas.length)})
                    </span>
                  </button>
                </div>
              )}
            </section>

            {/* ---------------------------------------------------------- panel */}
            <aside aria-label="Visita elegida" className="hidden lg:sticky lg:top-[84px] lg:block">
              {actual ? (
                <PanelVisita
                  fila={actual}
                  queFoto={queFoto}
                  nombreFecha={nombreFecha}
                  extras={[
                    ...(detalle ? detalle(actual) : []),
                    ...datosRepetida(repetidaDe(actual)),
                    ...datosVisto(vistoDe(actual)),
                  ]}
                  revision={revisionDe(actual)}
                  puedeMarcar={puedeMarcar}
                  rota={esRota(actual)}
                  posicion={posActual}
                  total={conFoto.length}
                  onRota={marcarRota}
                  onMarcar={(estado) => marcar(actual, estado)}
                  onIr={(i) => setElegida(conFoto[i] ?? null)}
                  onGrande={() => setAbierta(fotos.primera.get(actual) ?? null)}
                />
              ) : (
                <p className="tarjeta px-5 py-10 text-center text-[13px] text-[var(--color-tinta-suave)]">
                  No hay fotos para mostrar con estos filtros.
                </p>
              )}
            </aside>
          </div>

          {/* Barra del celular: más filtros y la descarga, siempre a la mano. */}
          <div className="sticky bottom-0 z-20 -mx-4 flex gap-2.5 border-t border-[var(--color-linea)] bg-[var(--color-papel)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_var(--color-sombra)] sm:hidden">
            <button
              type="button"
              aria-expanded={masFiltros}
              aria-controls={`${prefijo}-filtros`}
              onClick={() => {
                setMasFiltros((v) => !v);
                document.getElementById(`${prefijo}-filtros`)?.scrollIntoView({ behavior: "smooth" });
              }}
              className="boton boton-secundario"
            >
              <SlidersHorizontal size={16} aria-hidden />
              Filtros
              {otrosFiltros > 0 && (
                <span className="cifras grid h-5 min-w-5 place-items-center rounded-full bg-[var(--color-tinta)] px-1.5 text-xs text-[var(--color-sobre-tinta)]">
                  {otrosFiltros}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={descargar}
              disabled={filtradas.length === 0}
              className="boton boton-ambar flex-1"
            >
              <Sheet size={16} aria-hidden />
              Excel ({cifra(filtradas.length)})
            </button>
          </div>
        </>
      )}

      {abierta !== null && fotos.lista[abierta] && (
        <Visor
          foto={fotos.lista[abierta]}
          queFoto={queFoto}
          posicion={abierta}
          total={fotos.lista.length}
          rota={rotas.has(fotos.lista[abierta].url)}
          revision={revisionDe(fotos.lista[abierta].fila)}
          puedeMarcar={puedeMarcar}
          onMarcar={(estado) => marcar(fotos.lista[abierta].fila, estado)}
          onRota={marcarRota}
          onIr={setAbierta}
          onCerrar={() => setAbierta(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- piezas

/** Insignia de la revisión sobre la foto. */
function Insignia({ revision }: { revision: Revision | null }) {
  if (!revision) return null;
  const correcta = revision.estado === "correcta";
  return (
    <span
      className={`absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow ${
        correcta
          ? "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]"
          : "bg-[var(--color-aviso-fondo)] text-[var(--color-aviso-tinta)]"
      }`}
    >
      {correcta ? <Check size={12} aria-hidden /> : <TriangleAlert size={12} aria-hidden />}
      {correcta ? "Correcta" : "Para revisar"}
    </span>
  );
}

/** Una visita de la galería: su foto (o por qué no hay) y sus datos. */
/** Si lo que vio la IA en la visita cumple el filtro. */
function cumpleVisto(v: Visto | null, filtro: string): boolean {
  if (!v) return false;
  if (filtro === SIN_REVISAR) return !v.revisada;
  if (!v.revisada) return false;
  if (filtro === NINGUNA) return v.ve.length === 0 && !v.ilegible;
  if (filtro === ILEGIBLES) return v.ilegible;
  return v.ve.includes(filtro);
}

/** «libro, persona», «nada de la lista» o «foto ilegible». */
function textoVisto(v: Visto): string {
  if (v.ve.length > 0) return v.ve.join(", ");
  return v.ilegible ? "foto ilegible" : "nada de la lista";
}

/** Lo que vio la IA, para la visita elegida. */
function datosVisto(v: Visto | null): [string, string][] {
  if (!v) return [];
  return [["La IA ve", v.revisada ? textoVisto(v) : "Sin revisar"]];
}

/** Lo que se dice de una repetida en la visita elegida. */
function datosRepetida(r: Repetida | null): [string, string][] {
  if (!r) return [];
  const salida: [string, string][] = [["Repetida", `Grupo ${r.numero}, ${r.visitas} visitas`]];
  if (r.ia !== null) salida.push(["IA", `${r.ia ? "Misma foto" : "Foto distinta"}${r.motivo ? `: ${r.motivo}` : ""}`]);
  return salida;
}

/** La marca de foto repetida, abajo a la izquierda de la miniatura. */
function InsigniaRepetida({ repetida }: { repetida: Repetida }) {
  const color =
    repetida.ia === true
      ? "bg-[var(--color-alerta)] text-[var(--color-sobre-alerta)]"
      : repetida.ia === false
        ? "bg-black/70 text-white"
        : "bg-[var(--color-aviso-fondo)] text-[var(--color-aviso-tinta)]";
  return (
    <span className={`cifras absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow ${color}`}>
      <Copy size={11} aria-hidden />
      {repetida.ia === false ? `Grupo ${repetida.numero} · IA: otra foto` : `Repetida · grupo ${repetida.numero}`}
    </span>
  );
}

function Tarjeta({
  fila,
  elegida,
  repetida,
  revision,
  rota,
  onRota,
  onAbrir,
}: {
  fila: FilaImagen;
  elegida: boolean;
  repetida: Repetida | null;
  revision: Revision | null;
  rota: boolean;
  onRota: (url: string) => void;
  onAbrir: () => void;
}) {
  const datos = (
    <span className="block px-2.5 pt-2 pb-2.5 text-left">
      <span className="block truncate text-[13px] leading-snug font-medium" title={pdvDe(fila)}>
        {pdvDe(fila)}
      </span>
      <span className="cifras mt-0.5 block truncate text-xs text-[var(--color-tinta-suave)]">
        {[fila.cod_personalizado, usuarioDe(fila), fila.hora].filter(Boolean).join(" · ")}
      </span>
    </span>
  );
  const marco = "flex aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 px-3 text-center text-xs";
  const borde = elegida
    ? "border-2 border-[var(--color-tinta)] lg:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-ambar)_35%,transparent)]"
    : "border border-[var(--color-linea)]";

  // Sin foto no hay nada que abrir: la tarjeta queda solo para leer.
  if (fila.estado !== "con_foto") {
    return (
      <div className={`overflow-hidden rounded-[6px] bg-[var(--color-papel)] ${borde}`}>
        {fila.estado === "sin_foto" ? (
          <span className={`${marco} bg-[var(--color-alerta-fondo)] font-medium text-[var(--color-alerta)]`}>
            <ImageOff size={20} aria-hidden />
            Sin foto
          </span>
        ) : (
          <span className={`${marco} bg-[var(--color-relleno)] text-[var(--color-tinta-suave)]`}>
            <ImageOff size={20} aria-hidden />
            <span>El valor no es un enlace</span>
            <span className="line-clamp-2 w-full text-[11px] break-all">{fila.foto_visita_inicio}</span>
          </span>
        )}
        {datos}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-pressed={elegida}
      aria-label={`Ver la foto de ${pdvDe(fila)}${revision ? (revision.estado === "correcta" ? ", correcta" : ", para revisar") : ""}${repetida ? `, repetida en el grupo ${repetida.numero}` : ""}`}
      className={`block w-full overflow-hidden rounded-[6px] bg-[var(--color-papel)] ${borde} hover:border-[var(--color-tinta)]`}
    >
      <span className="relative block aspect-[4/3] w-full bg-[var(--color-mapa)]">
        {rota ? (
          <span className={`${marco} h-full bg-[var(--color-aviso-fondo)] font-medium text-[var(--color-aviso-tinta)]`}>
            <ImageOff size={20} aria-hidden />
            La foto no cargó
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- foto externa, sin optimizar
          <img
            src={fila.fotos[0]}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => onRota(fila.fotos[0])}
            className="h-full w-full object-cover"
          />
        )}
        <Insignia revision={revision} />
        {repetida && <InsigniaRepetida repetida={repetida} />}
        {fila.fotos.length > 1 && (
          <span className="cifras absolute right-1.5 bottom-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">
            {fila.fotos.length} fotos
          </span>
        )}
      </span>
      {datos}
    </button>
  );
}

/** Un dato de más en la visita elegida: el nombre de la columna y su valor. */
function ParDato({ nombre, valor }: { nombre: string; valor: string }) {
  return (
    <>
      <dt className="max-w-[9rem] truncate text-[var(--color-tinta-suave)]" title={nombre}>
        {nombre}
      </dt>
      <dd className="break-words">{valor}</dd>
    </>
  );
}

/** Correcta / Para revisar. Tocar la marca puesta la quita. */
function BotonesRevision({
  revision,
  puedeMarcar,
  onMarcar,
  oscuro = false,
}: {
  revision: Revision | null;
  puedeMarcar: boolean;
  onMarcar: (estado: EstadoRevision | null) => void;
  /** En el visor, sobre fondo negro. */
  oscuro?: boolean;
}) {
  const opciones: { id: EstadoRevision; nombre: string; Icono: typeof Check }[] = [
    { id: "correcta", nombre: "Correcta", Icono: Check },
    { id: "revisar", nombre: "Para revisar", Icono: TriangleAlert },
  ];
  return (
    <div role="group" aria-label="Revisión de la foto" className="flex gap-2">
      {opciones.map((o) => {
        const puesta = revision?.estado === o.id;
        const color =
          o.id === "correcta"
            ? "border-[var(--color-exito)] bg-[var(--color-exito-fondo)] text-[var(--color-exito)]"
            : "border-[var(--color-aviso-borde)] bg-[var(--color-aviso-fondo)] text-[var(--color-aviso-tinta)]";
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={puesta}
            disabled={!puedeMarcar}
            title={puedeMarcar ? (puesta ? "Quitar la marca" : undefined) : "Falta ejecutar supabase/panel.sql"}
            onClick={() => onMarcar(puesta ? null : o.id)}
            className={`boton boton-chico flex-1 ${
              puesta
                ? color
                : oscuro
                  ? "border-white/30 bg-white/10 text-white hover:border-white/60"
                  : "boton-secundario"
            }`}
          >
            <o.Icono size={14} aria-hidden />
            {o.nombre}
          </button>
        );
      })}
    </div>
  );
}

/** La visita elegida, a la derecha de la galería en pantallas grandes. */
function PanelVisita({
  fila,
  queFoto,
  nombreFecha,
  extras,
  revision,
  puedeMarcar,
  rota,
  posicion,
  total,
  onRota,
  onMarcar,
  onIr,
  onGrande,
}: {
  fila: FilaImagen;
  queFoto: string;
  nombreFecha: string;
  extras: [string, string][];
  revision: Revision | null;
  puedeMarcar: boolean;
  rota: boolean;
  posicion: number;
  total: number;
  onRota: (url: string) => void;
  onMarcar: (estado: EstadoRevision | null) => void;
  onIr: (posicion: number) => void;
  onGrande: () => void;
}) {
  return (
    <div className="tarjeta overflow-hidden">
      <button
        type="button"
        onClick={onGrande}
        aria-label="Ver la foto en grande"
        className="group relative block aspect-[4/3] w-full bg-[var(--color-mapa)]"
      >
        {rota ? (
          <span className="flex h-full flex-col items-center justify-center gap-2 bg-[var(--color-aviso-fondo)] px-6 text-center text-[13px] font-medium text-[var(--color-aviso-tinta)]">
            <ImageOff size={24} aria-hidden />
            La foto no cargó. Prueba abrir el original.
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- foto externa, sin optimizar
          <img
            key={fila.fotos[0]}
            src={fila.fotos[0]}
            alt={`${queFoto} en ${pdvDe(fila)}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => onRota(fila.fotos[0])}
            className="h-full w-full object-cover"
          />
        )}
        <span className="absolute right-2 bottom-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white opacity-80 group-hover:opacity-100">
          <Maximize2 size={15} aria-hidden />
        </span>
      </button>

      <div className="space-y-4 px-4 pt-3.5 pb-4">
        <div>
          <p className="text-[15px] leading-snug font-semibold">{pdvDe(fila)}</p>
          <dl className="cifras mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-[var(--color-tinta-suave)]">Código</dt>
            <dd>{fila.cod_personalizado ?? "—"}</dd>
            <dt className="text-[var(--color-tinta-suave)]">Consultor</dt>
            <dd className="truncate">{usuarioDe(fila)}</dd>
            <dt className="text-[var(--color-tinta-suave)]">{nombreFecha}</dt>
            <dd>{fechaDe(fila) ?? "Sin fecha"}</dd>
            {fila.fotos.length > 1 && (
              <>
                <dt className="text-[var(--color-tinta-suave)]">Fotos</dt>
                <dd>{fila.fotos.length}</dd>
              </>
            )}
            {extras.map(([nombre, valor], i) => (
              <ParDato key={i} nombre={nombre} valor={valor} />
            ))}
          </dl>
        </div>

        <div>
          <p className="mb-1.5 text-xs text-[var(--color-tinta-suave)]">¿Cómo está la foto?</p>
          <BotonesRevision revision={revision} puedeMarcar={puedeMarcar} onMarcar={onMarcar} />
          {revision?.revisado_por && (
            <p className="mt-1.5 text-xs text-[var(--color-tinta-suave)]">
              Marcada por {revision.revisado_por}
              {revision.actualizado ? `, ${cuando(revision.actualizado)}` : ""}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-linea)] pt-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onIr(posicion - 1)}
              disabled={posicion <= 0}
              aria-label="Foto anterior"
              className="boton boton-secundario boton-chico px-2.5"
            >
              <ChevronLeft size={16} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onIr(posicion + 1)}
              disabled={posicion >= total - 1}
              aria-label="Foto siguiente"
              className="boton boton-secundario boton-chico px-2.5"
            >
              <ChevronRight size={16} aria-hidden />
            </button>
            <span className="cifras ml-1 text-xs text-[var(--color-tinta-suave)]">
              {cifra(posicion + 1)} de {cifra(total)}
            </span>
          </div>
          <a
            href={fila.fotos[0]}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium underline underline-offset-2"
          >
            <ExternalLink size={13} aria-hidden />
            Abrir original
          </a>
        </div>
      </div>
    </div>
  );
}

/** La foto en grande, con sus datos y flechas para pasar a la anterior o la siguiente. */
function Visor({
  foto,
  queFoto,
  posicion,
  total,
  rota,
  revision,
  puedeMarcar,
  onMarcar,
  onRota,
  onIr,
  onCerrar,
}: {
  foto: Foto;
  queFoto: string;
  posicion: number;
  total: number;
  rota: boolean;
  revision: Revision | null;
  puedeMarcar: boolean;
  onMarcar: (estado: EstadoRevision | null) => void;
  onRota: (url: string) => void;
  onIr: (posicion: number) => void;
  onCerrar: () => void;
}) {
  const cerrar = useRef<HTMLButtonElement>(null);
  const hayAnterior = posicion > 0;
  const haySiguiente = posicion < total - 1;

  // Al abrir: el foco va al visor y la página de atrás deja de moverse.
  // Al cerrar: el foco vuelve a la miniatura desde donde se abrió.
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    const desborde = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cerrar.current?.focus();
    return () => {
      document.body.style.overflow = desborde;
      antes?.focus();
    };
  }, []);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
      else if (e.key === "ArrowLeft" && hayAnterior) onIr(posicion - 1);
      else if (e.key === "ArrowRight" && haySiguiente) onIr(posicion + 1);
    };
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [posicion, hayAnterior, haySiguiente, onIr, onCerrar]);

  const flecha =
    "grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25 disabled:opacity-25 disabled:hover:bg-white/15";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Foto de ${pdvDe(foto.fila)}`}
      className="fixed inset-0 z-[100] flex flex-col bg-black/90"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{pdvDe(foto.fila)}</p>
          <p className="cifras mt-0.5 truncate text-xs text-white/70">
            {[foto.fila.cod_personalizado, usuarioDe(foto.fila), fechaDe(foto.fila)]
              .filter(Boolean)
              .join(" · ")}
            {foto.de > 1 && ` · foto ${foto.numero} de ${foto.de}`}
          </p>
        </div>
        <button
          ref={cerrar}
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <div
        className="flex min-h-0 flex-1 items-center gap-2 px-2 sm:px-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onCerrar();
        }}
      >
        <button
          type="button"
          onClick={() => onIr(posicion - 1)}
          disabled={!hayAnterior}
          aria-label="Foto anterior"
          className={flecha}
        >
          <ChevronLeft size={22} aria-hidden />
        </button>

        <div className="flex h-full min-w-0 flex-1 items-center justify-center">
          {rota ? (
            <p className="flex flex-col items-center gap-2 text-sm text-white/80">
              <ImageOff size={28} aria-hidden />
              La foto no cargó. Prueba a abrir el original.
            </p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- foto externa, sin optimizar
            <img
              key={foto.url}
              src={foto.url}
              alt={`${queFoto} en ${pdvDe(foto.fila)}`}
              referrerPolicy="no-referrer"
              onError={() => onRota(foto.url)}
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>

        <button
          type="button"
          onClick={() => onIr(posicion + 1)}
          disabled={!haySiguiente}
          aria-label="Foto siguiente"
          className={flecha}
        >
          <ChevronRight size={22} aria-hidden />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-white/70">
        <span className="cifras">
          {cifra(posicion + 1)} de {cifra(total)}
        </span>
        <div className="order-last w-full sm:order-none sm:w-auto sm:min-w-[280px]">
          <BotonesRevision revision={revision} puedeMarcar={puedeMarcar} onMarcar={onMarcar} oscuro />
        </div>
        <a
          href={foto.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-white underline underline-offset-2"
        >
          <ExternalLink size={13} aria-hidden />
          Abrir original
        </a>
      </div>
    </div>
  );
}
