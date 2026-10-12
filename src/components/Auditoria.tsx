"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  SlidersHorizontal,
  Sheet,
  TriangleAlert,
  Undo2,
  Upload,
} from "lucide-react";
import { exportarAuditoria } from "@/lib/excel";
import {
  SIN_RANGO,
  dentroDelRango,
  fechaLegible,
  hayRango,
  rangoAlReves,
  resumirFechas,
  sufijoRango,
  textoRango,
  type Rango,
} from "@/lib/fechas";
import { escribirExcel, limpiarAuditoria, limpiarTexto } from "@/lib/limpiadorAuditoria";
import { filasDesdeAthena, type FilaAuditoria } from "@/lib/auditoria";
import { guardarResumenAuditoria, resumirAuditoria } from "@/lib/resumenAuditoria";
import { claveHallazgo, copiaDelHallazgo, leerClavesRevisadas } from "@/lib/revisionHallazgos";
import CargaMasivaRevisados from "./CargaMasivaRevisados";
import EncabezadoPagina from "./EncabezadoPagina";
import FiltrosActivos, { type FiltroActivo } from "./FiltrosActivos";
import RangoFechas from "./RangoFechas";
import {
  BotonReconsultar,
  ProgresoConsulta,
  cifra,
  esperar,
  sinTildes,
  textoConsulta,
  useConsultaAthena,
} from "./ConsultaAthena";

const POR_PAGINA = 50;

const usuarioDe = (f: FilaAuditoria) => limpiarTexto(f.nombre_usuario) ?? "Sin consultor";
const lineaDe = (f: FilaAuditoria) => limpiarTexto(f.tipo_linea) ?? "Sin tipo de línea";
const pdvDe = (f: FilaAuditoria) => limpiarTexto(f.nombre_personalizado) ?? "PDV sin nombre";

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Descarga principal (Excel limpio) y, al lado, el menú con los datos sin limpiar. */
function BotonDescargas({
  armando,
  deshabilitado,
  onLimpio,
  onCrudo,
}: {
  armando: boolean;
  deshabilitado: boolean;
  onLimpio: () => void;
  onCrudo: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  return (
    <div ref={caja} className="relative inline-flex">
      <button
        type="button"
        onClick={onLimpio}
        disabled={deshabilitado || armando}
        aria-busy={armando}
        className="boton boton-ambar rounded-r-none"
      >
        {armando ? (
          <Loader2 size={16} className="animate-spin" aria-hidden />
        ) : (
          <Sheet size={16} aria-hidden />
        )}
        {armando ? "Armando el Excel…" : "Excel limpio"}
      </button>
      <button
        type="button"
        aria-label="Más descargas"
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        disabled={deshabilitado || armando}
        className="boton boton-ambar rounded-l-none border-l-[var(--color-ambar-oscuro)] px-3"
      >
        <ChevronDown size={16} aria-hidden />
      </button>
      {abierto && (
        <div
          role="menu"
          className="tarjeta absolute top-full right-0 z-20 mt-1.5 w-72 p-1 shadow-[0_8px_24px_var(--color-sombra)]"
        >
          {[
            { nombre: "Excel limpio", detalle: "Pasa por el limpiador: tildes, preguntas unificadas y ocho hojas.", accion: onLimpio },
            { nombre: "Datos sin limpiar", detalle: "Las columnas de la consulta tal cual, más el motivo.", accion: onCrudo },
          ].map((o) => (
            <button
              key={o.nombre}
              type="button"
              role="menuitem"
              onClick={() => {
                setAbierto(false);
                o.accion();
              }}
              className="block w-full rounded-[4px] px-3 py-2.5 text-left hover:bg-[var(--color-hover)]"
            >
              <span className="block text-[14px] font-medium">{o.nombre}</span>
              <span className="mt-0.5 block text-xs leading-snug text-[var(--color-tinta-suave)]">
                {o.detalle}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Auditoria() {
  const { fase, filas, info, consultar, trabajando } = useConsultaAthena<FilaAuditoria>(
    "/api/admin/auditoria",
    filasDesdeAthena
  );
  const [aviso, setAviso] = useState<string | null>(null);
  /** Rango de fechas: delimita lo que se ve y los dos Excel. */
  const [rango, setRango] = useState<Rango>(SIN_RANGO);
  const [consultor, setConsultor] = useState("");
  const [linea, setLinea] = useState("");
  const [motivo, setMotivo] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(0);
  const [armando, setArmando] = useState(false);
  /** En el celular, los filtros además de las fechas van plegados. */
  const [masFiltros, setMasFiltros] = useState(false);
  const inicioTabla = useRef<HTMLDivElement>(null);

  // ------------------------------------------------------------ revisados
  /** Claves de los hallazgos que alguien ya revisó: no salen en la lista. */
  const [revisados, setRevisados] = useState<Set<string>>(() => new Set());
  /** Falta la tabla (hallazgos.sql): se ve todo y no se puede marcar. */
  const [sinRevision, setSinRevision] = useState<string | null>(null);
  /** El último marcado, para poder deshacerlo. */
  const [deshacer, setDeshacer] = useState<{ claves: string[]; nombre: string } | null>(null);
  /** El guardado en curso: deshacer espera a que termine. */
  const guardando = useRef<Promise<unknown>>(Promise.resolve());
  /** La ventana de carga masiva. */
  const [cargaMasiva, setCargaMasiva] = useState(false);

  function cargarRevisados() {
    leerClavesRevisadas().then(({ claves, aviso }) => {
      setRevisados(claves);
      setSinRevision(aviso);
    });
  }

  useEffect(cargarRevisados, []);

  // El aviso de deshacer se va solo.
  useEffect(() => {
    if (!deshacer) return;
    const reloj = window.setTimeout(() => setDeshacer(null), 9000);
    return () => window.clearTimeout(reloj);
  }, [deshacer]);

  /** Nueva consulta: se limpian los filtros de la anterior. */
  function reconsultar(fresca: boolean) {
    // Lo que otros hayan revisado mientras tanto también sale de la lista.
    cargarRevisados();
    setAviso(null);
    setRango(SIN_RANGO);
    setConsultor("");
    setLinea("");
    setMotivo(null);
    setBusqueda("");
    setPagina(0);
    consultar(fresca);
  }

  function filtrar<T>(cambiar: (valor: T) => void) {
    return (valor: T) => {
      cambiar(valor);
      setPagina(0);
    };
  }

  // ------------------------------------------------------------ derivados
  const claves = useMemo(() => new Map(filas.map((f) => [f, claveHallazgo(f)])), [filas]);
  const claveDe = useCallback((f: FilaAuditoria) => claves.get(f) ?? claveHallazgo(f), [claves]);

  /** Lo que falta revisar: de aquí sale todo lo que se ve y los dos Excel. */
  const pendientes = useMemo(
    () => (revisados.size === 0 ? filas : filas.filter((f) => !revisados.has(claves.get(f) ?? ""))),
    [filas, revisados, claves]
  );
  const yaRevisados = filas.length - pendientes.length;

  // Lo último que se vio queda como resumen para el Inicio, sin los revisados.
  useEffect(() => {
    if (fase.tipo === "listo" && filas.length > 0) {
      guardarResumenAuditoria(resumirAuditoria(pendientes, info?.enviada ?? null, yaRevisados));
    }
  }, [fase.tipo, filas.length, pendientes, info, yaRevisados]);

  const fechas = useMemo(() => resumirFechas(pendientes, (f) => f.dia, (f) => f.fecha), [pendientes]);
  const conRango = hayRango(rango);
  const alReves = rangoAlReves(rango);

  /** Los hallazgos pendientes de las fechas, en el orden de la consulta: van a los dos Excel. */
  const enRango = useMemo(
    () => (conRango ? pendientes.filter((f) => dentroDelRango(f.dia, rango)) : pendientes),
    [pendientes, conRango, rango]
  );

  const indice = useMemo(
    () =>
      new Map(
        filas.map((f) => [
          f,
          sinTildes(
            [
              f.codigo_bavaria,
              f.nombre_personalizado,
              f.nombre_usuario,
              f.departamento,
              f.provincia,
              limpiarTexto(f.componente_etiqueta),
              limpiarTexto(f.componente_valor),
              limpiarTexto(f.tipo_linea),
            ]
              .filter(Boolean)
              .join(" ")
          ),
        ])
      ),
    [filas]
  );

  // Los selectores cuentan dentro de las fechas; la lista sale de toda la consulta.
  const opciones = useMemo(() => {
    const porConsultor = new Map<string, number>();
    const porLinea = new Map<string, number>();
    for (const f of pendientes) {
      porConsultor.set(usuarioDe(f), 0);
      porLinea.set(lineaDe(f), 0);
    }
    for (const f of enRango) {
      porConsultor.set(usuarioDe(f), (porConsultor.get(usuarioDe(f)) ?? 0) + 1);
      porLinea.set(lineaDe(f), (porLinea.get(lineaDe(f)) ?? 0) + 1);
    }
    const ordenar = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
    return { consultores: ordenar(porConsultor), lineas: ordenar(porLinea) };
  }, [pendientes, enRango]);

  const q = sinTildes(busqueda.trim());

  /** Todos los filtros menos el motivo: de aquí salen las barras por motivo. */
  const base = useMemo(
    () =>
      enRango.filter(
        (f) =>
          (!consultor || usuarioDe(f) === consultor) &&
          (!linea || lineaDe(f) === linea) &&
          (!q || (indice.get(f) ?? "").includes(q))
      ),
    [enRango, consultor, linea, q, indice]
  );

  const motivos = useMemo(() => {
    const conteo = new Map<string, number>();
    for (const f of base) conteo.set(f.motivo, (conteo.get(f.motivo) ?? 0) + 1);
    // El motivo elegido se queda a la vista aunque con estos filtros no tenga hallazgos.
    if (motivo && !conteo.has(motivo)) conteo.set(motivo, 0);
    return [...conteo.entries()]
      .map(([nombre, n]) => ({ nombre, n }))
      .sort((a, b) => b.n - a.n);
  }, [base, motivo]);

  /** Lo que se ve: con todos los filtros, del más reciente al más antiguo. */
  const vista = useMemo(() => {
    const lista = motivo ? base.filter((f) => f.motivo === motivo) : base;
    return [...lista].sort((a, b) => (a.orden === b.orden ? 0 : a.orden < b.orden ? 1 : -1));
  }, [base, motivo]);

  const cuentas = useMemo(
    () => ({
      consultores: new Set(vista.map((f) => limpiarTexto(f.nombre_usuario)).filter(Boolean)).size,
      pdv: new Set(vista.map((f) => (f.codigo_bavaria ?? "").trim()).filter(Boolean)).size,
    }),
    [vista]
  );

  const paginas = Math.max(1, Math.ceil(vista.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const visibles = vista.slice(pag * POR_PAGINA, (pag + 1) * POR_PAGINA);

  function irAPagina(n: number) {
    setPagina(n);
    inicioTabla.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ------------------------------------------------------------ marcar revisado
  /** Lo marca como revisado: sale de la lista enseguida y se guarda detrás. */
  function marcarRevisado(f: FilaAuditoria) {
    const clave = claves.get(f) ?? claveHallazgo(f);
    setAviso(null);
    setRevisados((antes) => new Set(antes).add(clave));
    setDeshacer({ claves: [clave], nombre: pdvDe(f) });

    guardando.current = (async () => {
      try {
        const r = await fetch("/api/admin/revision-hallazgos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hallazgos: [copiaDelHallazgo(f, clave)] }),
        });
        if (r.ok) return;
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? "No se pudo marcar como revisado.");
      } catch (e) {
        // No quedó guardado: vuelve a la lista.
        setRevisados((antes) => {
          const s = new Set(antes);
          s.delete(clave);
          return s;
        });
        setDeshacer(null);
        setAviso((e as Error).message || "No se pudo marcar como revisado.");
      }
    })();
  }

  /** Devuelve a pendientes lo último que se marcó. */
  async function deshacerUltimo() {
    if (!deshacer) return;
    const { claves: devolver } = deshacer;
    setDeshacer(null);
    await guardando.current;
    setRevisados((antes) => {
      const s = new Set(antes);
      devolver.forEach((c) => s.delete(c));
      return s;
    });
    try {
      const r = await fetch("/api/admin/revision-hallazgos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claves: devolver }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setRevisados((antes) => new Set([...antes, ...devolver]));
      setAviso("No se pudo deshacer. Puedes devolverlo desde Revisados.");
    }
  }

  /** Lo que marcó o devolvió la carga masiva sale o vuelve a la lista. */
  const alMarcarEnBloque = useCallback((marcadas: string[]) => {
    setAviso(null);
    setDeshacer(null);
    setRevisados((antes) => new Set([...antes, ...marcadas]));
  }, []);
  const alDevolverEnBloque = useCallback((devueltas: string[]) => {
    setRevisados((antes) => {
      const s = new Set(antes);
      devueltas.forEach((c) => s.delete(c));
      return s;
    });
  }, []);

  /** El botón de cada hallazgo. */
  const botonRevisado = (f: FilaAuditoria, ancho = false) =>
    !sinRevision && (
      <button
        type="button"
        onClick={() => marcarRevisado(f)}
        title="Marcar como revisado: sale de esta lista y pasa a Revisados"
        aria-label={`Marcar como revisado: ${pdvDe(f)}, ${f.motivo}`}
        className={`boton boton-secundario boton-chico ${ancho ? "w-full" : ""}`}
      >
        <CheckCheck size={14} aria-hidden />
        Revisado
      </button>
    );

  // ------------------------------------------------------------ descargas
  /**
   * Excel limpio: los hallazgos del rango de fechas (sin rango, todos) pasan
   * por el limpiador de auditoría (tildes, preguntas unificadas, tipo de línea)
   * y salen sus ocho hojas. fila_excel apunta a la fila del Excel sin limpiar
   * descargado con las mismas fechas, que trae las filas en este mismo orden.
   */
  async function descargarLimpio() {
    setArmando(true);
    setAviso(null);
    // Un respiro para que se pinte el "Armando…" antes del trabajo pesado.
    await esperar(30);
    try {
      // El rango queda escrito en la hoja «Notas», como origen de los datos.
      const origen = conRango ? `Consulta de auditoría (${textoRango(rango)})` : "Consulta de auditoría";
      const r = limpiarAuditoria(enRango, origen);
      if (!r) {
        setAviso("La auditoría no trae filas con datos para limpiar.");
        return;
      }
      const datos = await escribirExcel(r.hojas);
      const url = URL.createObjectURL(
        new Blob([datos], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        })
      );
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = `auditoria_bavaria_puntos_limpia_${sufijoRango(rango)}.xlsx`;
      enlace.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      console.error("[auditoria excel limpio]", e);
      setAviso("No se pudo armar el Excel limpio. Intenta de nuevo.");
    } finally {
      setArmando(false);
    }
  }

  function descargarSinLimpiar() {
    try {
      exportarAuditoria(enRango, sufijoRango(rango));
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
      quitar: () => filtrar(setRango)(SIN_RANGO),
    });
  }
  if (consultor) puestos.push({ id: "consultor", etiqueta: `Consultor: ${consultor}`, quitar: () => filtrar(setConsultor)("") });
  if (linea) puestos.push({ id: "linea", etiqueta: `Línea: ${linea}`, quitar: () => filtrar(setLinea)("") });
  if (motivo) puestos.push({ id: "motivo", etiqueta: `Motivo: ${motivo}`, quitar: () => filtrar(setMotivo)(null) });
  if (busqueda.trim()) puestos.push({ id: "busqueda", etiqueta: `«${busqueda.trim()}»`, quitar: () => filtrar(setBusqueda)("") });

  function quitarTodo() {
    setRango(SIN_RANGO);
    setConsultor("");
    setLinea("");
    setMotivo(null);
    setBusqueda("");
    setPagina(0);
  }

  const otrosFiltros = [consultor, linea, busqueda.trim()].filter(Boolean).length;
  const listo = fase.tipo === "listo" && filas.length > 0;

  // ------------------------------------------------------------ pantalla
  return (
    <div className="space-y-5">
      <EncabezadoPagina
        titulo="Auditoría de datos"
        descripcion={
          textoConsulta(info) ||
          "Respuestas de los formularios que no pasan las reglas de calidad, para corregirlas con cada consultor."
        }
        acciones={
          <>
            <BotonReconsultar trabajando={trabajando} onConsultar={() => reconsultar(true)} />
            {listo && !sinRevision && (
              <button type="button" onClick={() => setCargaMasiva(true)} className="boton boton-secundario">
                <Upload size={16} aria-hidden />
                Carga masiva
              </button>
            )}
            {listo && (
              <BotonDescargas
                armando={armando}
                deshabilitado={enRango.length === 0}
                onLimpio={descargarLimpio}
                onCrudo={descargarSinLimpiar}
              />
            )}
          </>
        }
      />

      <ProgresoConsulta fase={fase} onReintentar={() => reconsultar(false)} />

      {aviso && (
        <p className="flex items-center gap-2 rounded-[4px] bg-[var(--color-aviso-fondo)] px-3 py-2.5 text-[13px] text-[var(--color-aviso-tinta)]">
          <TriangleAlert size={14} className="shrink-0" aria-hidden />
          {aviso}
        </p>
      )}

      {fase.tipo === "listo" && filas.length === 0 && (
        <p className="rounded-[4px] border border-dashed border-[var(--color-linea)] px-4 py-6 text-center text-[13px] text-[var(--color-tinta-suave)]">
          La auditoría no encontró datos con problemas.
        </p>
      )}

      {listo && (
        <>
          {/* ---------------------------------------------------------- filtros */}
          <section aria-label="Filtros" id="auditoria-filtros" className="tarjeta scroll-mt-20 space-y-4 px-4 py-4 sm:px-5">
            <RangoFechas
              id="auditoria"
              rango={rango}
              onCambiar={filtrar(setRango)}
              fechas={fechas}
              uno="hallazgo"
              varios="hallazgos"
            />

            <div className={`${masFiltros ? "grid" : "hidden"} gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr]`}>
              <div>
                <label htmlFor="auditoria-consultor" className="campo-etiqueta">
                  Consultor
                </label>
                <select
                  id="auditoria-consultor"
                  value={consultor}
                  onChange={(e) => filtrar(setConsultor)(e.target.value)}
                  className="campo"
                >
                  <option value="">Todos los consultores</option>
                  {opciones.consultores.map(([u, n]) => (
                    <option key={u} value={u}>
                      {u} ({cifra(n)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="auditoria-linea" className="campo-etiqueta">
                  Tipo de línea
                </label>
                <select
                  id="auditoria-linea"
                  value={linea}
                  onChange={(e) => filtrar(setLinea)(e.target.value)}
                  className="campo"
                >
                  <option value="">Todas las líneas</option>
                  {opciones.lineas.map(([l, n]) => (
                    <option key={l} value={l}>
                      {l} ({cifra(n)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <label htmlFor="auditoria-buscar" className="campo-etiqueta">
                  Buscar
                </label>
                <input
                  id="auditoria-buscar"
                  type="search"
                  value={busqueda}
                  onChange={(e) => filtrar(setBusqueda)(e.target.value)}
                  placeholder="Código, PDV, consultor, departamento o respuesta"
                  className="campo"
                />
              </div>
            </div>

            <FiltrosActivos
              filtros={puestos}
              onQuitarTodo={quitarTodo}
              nota={
                enRango.length === 0
                  ? "No hay hallazgos en esas fechas para descargar."
                  : `Los Excel traen ${
                      conRango
                        ? enRango.length === 1
                          ? "el hallazgo de estas fechas"
                          : `los ${cifra(enRango.length)} hallazgos de estas fechas`
                        : `los ${cifra(pendientes.length)} hallazgos`
                    }${yaRevisados > 0 ? " sin revisar" : ""}; los demás filtros solo cambian lo que ves.`
              }
            />
          </section>

          {/* ---------------------------------------------------------- cifras */}
          <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                nombre: "Hallazgos",
                valor: cifra(vista.length),
                extra: vista.length !== pendientes.length ? `de ${cifra(pendientes.length)}` : null,
              },
              { nombre: "Consultores", valor: cifra(cuentas.consultores), extra: null },
              { nombre: "PDV con hallazgos", valor: cifra(cuentas.pdv), extra: null },
              {
                nombre: "Sin fecha",
                valor: cifra(fechas.sinFecha),
                extra: conRango && fechas.sinFecha > 0 ? "fuera del rango" : null,
              },
            ].map((c) => (
              <div key={c.nombre} className="tarjeta px-4 py-3.5 sm:px-5">
                <p className="text-[13px] text-[var(--color-tinta-suave)]">{c.nombre}</p>
                <p className="cifras mt-1 text-[24px] leading-tight font-semibold">
                  {c.valor}{" "}
                  {c.extra && (
                    <span className="text-[13px] font-normal text-[var(--color-tinta-suave)]">{c.extra}</span>
                  )}
                </p>
              </div>
            ))}
          </section>

          <div className="grid items-start gap-5 lg:grid-cols-[272px_minmax(0,1fr)]">
            {/* ---------------------------------------------------------- motivos */}
            <section aria-labelledby="por-motivo" className="tarjeta px-3 py-4">
              <h2 id="por-motivo" className="px-1.5 text-[15px] font-semibold">
                Por motivo
              </h2>
              <p className="mt-0.5 mb-2.5 px-1.5 text-xs text-[var(--color-tinta-suave)]">
                Toca uno para ver solo esos hallazgos.
              </p>
              <ul className="space-y-0.5">
                {motivos.map((m) => {
                  const activo = motivo === m.nombre;
                  return (
                    <li key={m.nombre}>
                      <button
                        type="button"
                        aria-pressed={activo}
                        onClick={() => filtrar(setMotivo)(activo ? null : m.nombre)}
                        className={`flex w-full flex-col gap-1.5 rounded-[6px] px-2.5 py-2 text-left ${
                          activo
                            ? "bg-[var(--color-tinta)] text-[var(--color-sobre-tinta)]"
                            : "hover:bg-[var(--color-hover)]"
                        }`}
                      >
                        <span className="flex justify-between gap-3 text-[13px] leading-snug">
                          <span>{m.nombre}</span>
                          <span className="cifras">{cifra(m.n)}</span>
                        </span>
                        <span
                          className={`block h-1.5 rounded-full ${
                            activo ? "bg-[color-mix(in_srgb,var(--color-sobre-tinta)_25%,transparent)]" : "bg-[var(--color-relleno)]"
                          }`}
                        >
                          <span
                            className={`block h-1.5 rounded-full ${
                              activo ? "bg-[var(--color-ambar)]" : "bg-[var(--color-tinta-suave)]"
                            }`}
                            style={{
                              width: `${m.n === 0 ? 0 : Math.max(3, (m.n / (motivos[0]?.n || 1)) * 100)}%`,
                            }}
                          />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* ---------------------------------------------------------- hallazgos */}
            <section aria-labelledby="hallazgos" className="tarjeta overflow-hidden">
              <div
                ref={inicioTabla}
                className="flex scroll-mt-24 flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-linea)] px-4 py-3.5 sm:px-5"
              >
                <h2 id="hallazgos" className="text-[15px] font-semibold">
                  Hallazgos
                </h2>
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-[var(--color-tinta-suave)]">
                  Del más reciente al más antiguo
                  {yaRevisados > 0 && (
                    <a href="#revisados" className="inline-flex items-center gap-1 font-medium text-[var(--color-tinta)] underline underline-offset-2">
                      {yaRevisados === 1 ? "1 ya revisado" : `${cifra(yaRevisados)} ya revisados`}
                      <ArrowRight size={12} aria-hidden />
                    </a>
                  )}
                </span>
              </div>

              {sinRevision && (
                <p className="border-b border-[var(--color-linea)] bg-[var(--color-aviso-fondo)] px-4 py-2.5 text-xs leading-snug text-[var(--color-aviso-tinta)] sm:px-5">
                  {sinRevision}
                </p>
              )}

              {vista.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] text-[var(--color-tinta-suave)]">
                  {pendientes.length === 0
                    ? "Todos los hallazgos de esta consulta ya están revisados."
                    : enRango.length === 0
                      ? yaRevisados > 0
                        ? "No hay hallazgos sin revisar en esas fechas."
                        : "No hay hallazgos en esas fechas."
                      : "Ningún hallazgo coincide con esos filtros."}
                </p>
              ) : (
                <>
                  {/* Tabla en pantallas medianas y grandes. */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="tabla min-w-[800px]">
                      <thead>
                        <tr>
                          <th scope="col">PDV</th>
                          <th scope="col">Pregunta</th>
                          <th scope="col">Respuesta</th>
                          <th scope="col">Motivo</th>
                          <th scope="col">Consultor y fecha</th>
                          {!sinRevision && (
                            <th scope="col">
                              <span className="sr-only">Revisión</span>
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {visibles.map((f, i) => (
                          <tr key={`${claves.get(f)}-${pag}-${i}`}>
                            <td className="max-w-[200px]">
                              <span className="block font-medium">{pdvDe(f)}</span>
                              <span className="cifras block text-xs text-[var(--color-tinta-suave)]">
                                {[f.codigo_bavaria, limpiarTexto(f.tipo_linea)].filter(Boolean).join(" · ")}
                              </span>
                            </td>
                            <td className="max-w-[260px] text-[var(--color-tinta-suave)]">
                              {limpiarTexto(f.componente_etiqueta) ?? "Sin pregunta"}
                            </td>
                            <td className="max-w-[160px] font-medium break-words">
                              {limpiarTexto(f.componente_valor) ?? (
                                <span className="font-normal text-[var(--color-alerta)]">Sin respuesta</span>
                              )}
                            </td>
                            <td className="max-w-[170px]">
                              <span className="inline-block rounded-[10px] bg-[var(--color-alerta-fondo)] px-2 py-0.5 text-xs leading-snug text-[var(--color-alerta)]">
                                {f.motivo}
                              </span>
                            </td>
                            <td className="whitespace-nowrap">
                              <span className="block">{limpiarTexto(f.nombre_usuario) ?? "—"}</span>
                              <span className="cifras block text-xs text-[var(--color-tinta-suave)]">
                                {fechaLegible(f.fecha) ?? "Sin fecha"}
                              </span>
                            </td>
                            {!sinRevision && <td className="w-[1%] whitespace-nowrap text-right">{botonRevisado(f)}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Tarjetas en el celular. */}
                  <ul className="divide-y divide-[var(--color-linea)] md:hidden">
                    {visibles.map((f, i) => (
                      <li key={`${claves.get(f)}-${pag}-${i}`} className="px-4 py-3">
                        <p className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 text-[14px] font-semibold">{pdvDe(f)}</span>
                          <span className="cifras shrink-0 text-xs text-[var(--color-tinta-suave)]">
                            {fechaLegible(f.fecha) ?? "Sin fecha"}
                          </span>
                        </p>
                        <p className="mt-1 text-[13px] leading-snug text-[var(--color-tinta-suave)]">
                          {limpiarTexto(f.componente_etiqueta) ?? "Sin pregunta"}
                        </p>
                        <p className="mt-1 text-[14px] break-words">
                          {limpiarTexto(f.componente_valor) ? (
                            <>
                              Respuesta: <b className="font-semibold">{limpiarTexto(f.componente_valor)}</b>
                            </>
                          ) : (
                            <span className="text-[var(--color-alerta)]">Sin respuesta</span>
                          )}
                        </p>
                        <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
                          <span className="rounded-full bg-[var(--color-alerta-fondo)] px-2 py-0.5 text-[var(--color-alerta)]">
                            {f.motivo}
                          </span>
                          {f.nombre_usuario && (
                            <span className="rounded-full bg-[var(--color-relleno)] px-2 py-0.5">
                              {limpiarTexto(f.nombre_usuario)}
                            </span>
                          )}
                          {f.codigo_bavaria && (
                            <span className="cifras rounded-full bg-[var(--color-relleno)] px-2 py-0.5">
                              {f.codigo_bavaria}
                            </span>
                          )}
                        </p>
                        {!sinRevision && <div className="mt-3">{botonRevisado(f, true)}</div>}
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-linea)] px-4 py-3 sm:px-5">
                    <span className="cifras text-[13px] text-[var(--color-tinta-suave)]">
                      {cifra(pag * POR_PAGINA + 1)}–{cifra(Math.min((pag + 1) * POR_PAGINA, vista.length))} de{" "}
                      {cifra(vista.length)}
                    </span>
                    {paginas > 1 && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => irAPagina(pag - 1)}
                          disabled={pag === 0}
                          className="boton boton-secundario boton-chico"
                        >
                          <ChevronLeft size={15} aria-hidden />
                          Anterior
                        </button>
                        <button
                          type="button"
                          onClick={() => irAPagina(pag + 1)}
                          disabled={pag >= paginas - 1}
                          className="boton boton-secundario boton-chico"
                        >
                          Siguiente
                          <ChevronRight size={15} aria-hidden />
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>

          {cargaMasiva && (
            <CargaMasivaRevisados
              filas={filas}
              revisados={revisados}
              claveDe={claveDe}
              pendientes={pendientes.length}
              onMarcados={alMarcarEnBloque}
              onDevueltos={alDevolverEnBloque}
              onCerrar={() => setCargaMasiva(false)}
            />
          )}

          {/* Lo último que se marcó, con la opción de deshacerlo. */}
          {deshacer && (
            <div
              role="status"
              className="fixed inset-x-4 bottom-24 z-[70] mx-auto flex max-w-md flex-wrap items-center gap-x-3 gap-y-2 rounded-[6px] bg-[var(--color-tinta)] px-4 py-3 text-[13px] text-[var(--color-sobre-tinta)] shadow-[0_8px_24px_var(--color-sombra)] sm:bottom-6"
            >
              <CheckCheck size={16} aria-hidden className="shrink-0" />
              <span className="min-w-0 flex-1">
                Revisado: <b className="font-semibold">{deshacer.nombre}</b>. Pasó a Revisados.
              </span>
              <button
                type="button"
                onClick={deshacerUltimo}
                className="inline-flex items-center gap-1.5 font-semibold underline underline-offset-2"
              >
                <Undo2 size={14} aria-hidden />
                Deshacer
              </button>
            </div>
          )}

          {/* Barra del celular: más filtros y la descarga, siempre a la mano. */}
          <div className="sticky bottom-0 z-20 -mx-4 flex gap-2.5 border-t border-[var(--color-linea)] bg-[var(--color-papel)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_var(--color-sombra)] sm:hidden">
            <button
              type="button"
              aria-expanded={masFiltros}
              aria-controls="auditoria-filtros"
              onClick={() => {
                setMasFiltros((v) => !v);
                document.getElementById("auditoria-filtros")?.scrollIntoView({ behavior: "smooth" });
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
              onClick={descargarLimpio}
              disabled={enRango.length === 0 || armando}
              className="boton boton-ambar flex-1"
            >
              {armando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Sheet size={16} aria-hidden />}
              {armando ? "Armando…" : "Excel limpio"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
