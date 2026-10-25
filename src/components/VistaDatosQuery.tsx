"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Sheet, SlidersHorizontal, TriangleAlert } from "lucide-react";
import {
  SIN_RANGO,
  dentroDelRango,
  fechaLegible,
  hayRango,
  leerFecha,
  rangoAlReves,
  resumirFechas,
  sufijoRango,
  textoRango,
  type Rango,
} from "@/lib/fechas";
import {
  ES_ENLACE,
  agruparPorDefecto,
  columnasDeFiltro,
  columnasUtiles,
  exportarDatos,
  nombreBonito,
  type FilaDatos,
} from "@/lib/datosQuery";
import type { Mapeo } from "@/lib/queriesFotos";
import FiltrosActivos, { type FiltroActivo } from "./FiltrosActivos";
import RangoFechas from "./RangoFechas";
import { cifra, sinTildes } from "./ConsultaAthena";

/**
 * Auditoría con query, vista de datos: lo que se ve cuando la query no trae
 * fotos. Es la pantalla de la auditoría de datos (fechas, consultor, buscador,
 * cifras, barras por columna y tabla de 50 en 50) pero con las columnas que
 * traiga la query. Lo que se ve es lo que baja el Excel.
 */

const POR_PAGINA = 50;
const SIN_VALOR = "(vacío)";

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Celda({ valor, esFecha }: { valor: string | null; esFecha: boolean }) {
  const v = (valor ?? "").trim();
  if (!v) return <span className="text-[var(--color-tinta-suave)]">—</span>;
  if (esFecha) return <>{fechaLegible(v)}</>;
  if (ES_ENLACE.test(v)) {
    return (
      <a href={v} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        Abrir enlace
      </a>
    );
  }
  return <>{v.length > 240 ? `${v.slice(0, 240)}…` : v}</>;
}

export default function VistaDatosQuery({
  columnas,
  crudas,
  mapeo,
  nombre,
}: {
  columnas: string[];
  crudas: FilaDatos[];
  mapeo: Mapeo;
  /** El nombre de la query, para el del archivo. */
  nombre: string;
}) {
  const pos = (c: string | null) => (c === null ? -1 : columnas.indexOf(c));
  const iFecha = pos(mapeo.fecha);
  const iConsultor = pos(mapeo.consultor);
  const iPdv = pos(mapeo.pdv);
  const iCodigo = pos(mapeo.codigo);

  const [rango, setRango] = useState<Rango>(SIN_RANGO);
  const [consultor, setConsultor] = useState("");
  /** Filtros de las listas desplegables, por nombre de columna. */
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const [agrupar, setAgrupar] = useState<string | null>(null);
  const [valorGrupo, setValorGrupo] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(0);
  const [masFiltros, setMasFiltros] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const inicioTabla = useRef<HTMLDivElement>(null);

  function filtrar<T>(cambiar: (valor: T) => void) {
    return (valor: T) => {
      cambiar(valor);
      setPagina(0);
    };
  }

  // ------------------------------------------------------------ derivados
  const todas = useMemo(() => crudas.map((_, i) => i), [crudas]);
  const dias = useMemo(
    () => crudas.map((f) => (iFecha < 0 ? null : (leerFecha(f[iFecha])?.dia ?? null))),
    [crudas, iFecha]
  );
  const indice = useMemo(() => crudas.map((f) => sinTildes(f.map((v) => v ?? "").join(" "))), [crudas]);

  const utiles = useMemo(() => columnasUtiles(columnas, crudas, mapeo), [columnas, crudas, mapeo]);
  const grupoActual =
    agrupar !== null && utiles.some((c) => c.nombre === agrupar) ? agrupar : agruparPorDefecto(utiles);
  const iGrupo = grupoActual === null ? -1 : columnas.indexOf(grupoActual);
  const listas = useMemo(() => columnasDeFiltro(utiles, grupoActual), [utiles, grupoActual]);

  const valorDe = (i: number, col: number) => (col < 0 ? "" : (crudas[i][col] ?? "").trim());

  const fechas = useMemo(
    () => resumirFechas(todas, (i) => dias[i], (i) => (iFecha < 0 ? null : crudas[i][iFecha])),
    [todas, dias, crudas, iFecha]
  );
  const conRango = hayRango(rango);
  const alReves = rangoAlReves(rango);

  const enRango = useMemo(
    () => (conRango ? todas.filter((i) => dentroDelRango(dias[i], rango)) : todas),
    [todas, dias, conRango, rango]
  );

  // Las listas cuentan dentro de las fechas; los valores salen de toda la query.
  const opcionesConsultor = useMemo(() => {
    if (iConsultor < 0) return [] as [string, number][];
    const m = new Map<string, number>();
    for (const i of todas) m.set(valorDe(i, iConsultor) || "Sin consultor", 0);
    for (const i of enRango) {
      const k = valorDe(i, iConsultor) || "Sin consultor";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todas, enRango, iConsultor, crudas]);

  const opcionesListas = useMemo(
    () =>
      listas.map((c) => {
        const m = new Map<string, number>();
        for (const i of todas) {
          const v = valorDe(i, c.indice);
          if (v) m.set(v, 0);
        }
        for (const i of enRango) {
          const v = valorDe(i, c.indice);
          if (v) m.set(v, (m.get(v) ?? 0) + 1);
        }
        return { ...c, valores: [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "es")) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listas, todas, enRango, crudas]
  );

  const q = sinTildes(busqueda.trim());

  /** Todos los filtros menos el valor de la columna agrupada: de aquí salen las barras. */
  const base = useMemo(
    () =>
      enRango.filter((i) => {
        if (consultor && (valorDe(i, iConsultor) || "Sin consultor") !== consultor) return false;
        for (const c of listas) {
          const elegido = filtros[c.nombre];
          if (elegido && valorDe(i, c.indice) !== elegido) return false;
        }
        return !q || indice[i].includes(q);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enRango, consultor, filtros, listas, q, indice, iConsultor, crudas]
  );

  const grupos = useMemo(() => {
    if (iGrupo < 0) return [];
    const conteo = new Map<string, number>();
    for (const i of base) {
      const k = valorDe(i, iGrupo) || SIN_VALOR;
      conteo.set(k, (conteo.get(k) ?? 0) + 1);
    }
    // El valor elegido se queda a la vista aunque con estos filtros no tenga filas.
    if (valorGrupo && !conteo.has(valorGrupo)) conteo.set(valorGrupo, 0);
    return [...conteo.entries()].map(([nombreG, n]) => ({ nombre: nombreG, n })).sort((a, b) => b.n - a.n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, iGrupo, valorGrupo, crudas]);

  /** Lo que se ve, en el orden de la query. */
  const vista = useMemo(
    () => (valorGrupo && iGrupo >= 0 ? base.filter((i) => (valorDe(i, iGrupo) || SIN_VALOR) === valorGrupo) : base),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, valorGrupo, iGrupo, crudas]
  );

  const cuentas = useMemo(() => {
    const consultores = new Set<string>();
    const pdv = new Set<string>();
    const iPunto = iCodigo >= 0 ? iCodigo : iPdv;
    for (const i of vista) {
      if (iConsultor >= 0) {
        const c = valorDe(i, iConsultor);
        if (c) consultores.add(c);
      }
      if (iPunto >= 0) {
        const p = valorDe(i, iPunto);
        if (p) pdv.add(p);
      }
    }
    return { consultores: consultores.size, pdv: pdv.size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, iConsultor, iCodigo, iPdv, crudas]);

  const sinFecha = useMemo(() => vista.filter((i) => dias[i] === null).length, [vista, dias]);

  const paginas = Math.max(1, Math.ceil(vista.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const visibles = vista.slice(pag * POR_PAGINA, (pag + 1) * POR_PAGINA);

  function irAPagina(n: number) {
    setPagina(n);
    inicioTabla.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function descargar() {
    setAviso(null);
    try {
      exportarDatos(columnas, vista.map((i) => crudas[i]), iFecha, nombre, sufijoRango(rango));
    } catch (e) {
      console.error("[query datos excel]", e);
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
  for (const c of listas) {
    const elegido = filtros[c.nombre];
    if (elegido) {
      puestos.push({
        id: `lista-${c.nombre}`,
        etiqueta: `${nombreBonito(c.nombre)}: ${elegido}`,
        quitar: () => filtrar(setFiltros)({ ...filtros, [c.nombre]: "" }),
      });
    }
  }
  if (valorGrupo && grupoActual) {
    puestos.push({
      id: "grupo",
      etiqueta: `${nombreBonito(grupoActual)}: ${valorGrupo.length > 60 ? `${valorGrupo.slice(0, 60)}…` : valorGrupo}`,
      quitar: () => filtrar(setValorGrupo)(null),
    });
  }
  if (busqueda.trim()) puestos.push({ id: "busqueda", etiqueta: `«${busqueda.trim()}»`, quitar: () => filtrar(setBusqueda)("") });

  function quitarTodo() {
    setRango(SIN_RANGO);
    setConsultor("");
    setFiltros({});
    setValorGrupo(null);
    setBusqueda("");
    setPagina(0);
  }

  const hayFiltrosExtra = iConsultor >= 0 || listas.length > 0;
  const columnasGrid = Math.min(3, (iConsultor >= 0 ? 1 : 0) + listas.length) + 1;

  if (crudas.length === 0) {
    return (
      <p className="rounded-[4px] border border-dashed border-[var(--color-linea)] px-4 py-6 text-center text-[13px] text-[var(--color-tinta-suave)]">
        La query no trajo filas.
      </p>
    );
  }

  const cifras = [
    {
      nombre: "Filas",
      valor: cifra(vista.length),
      extra: vista.length !== crudas.length ? `de ${cifra(crudas.length)}` : null,
    },
    ...(iConsultor >= 0 ? [{ nombre: "Consultores", valor: cifra(cuentas.consultores), extra: null }] : []),
    ...(iCodigo >= 0 || iPdv >= 0 ? [{ nombre: "PDV", valor: cifra(cuentas.pdv), extra: null }] : []),
    ...(iFecha >= 0
      ? [{ nombre: "Sin fecha", valor: cifra(sinFecha), extra: conRango && sinFecha > 0 ? "fuera del rango" : null }]
      : []),
  ];

  const maximo = grupos[0]?.n || 1;
  const iTitulo = iPdv >= 0 ? iPdv : 0;

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------------------- filtros */}
      <section aria-label="Filtros" id="query-datos-filtros" className="tarjeta scroll-mt-20 space-y-4 px-4 py-4 sm:px-5">
        {iFecha >= 0 ? (
          <RangoFechas
            id="query-datos"
            rango={rango}
            onCambiar={filtrar(setRango)}
            fechas={fechas}
            uno="fila"
            varios="filas"
            femenino
            columna={mapeo.fecha ?? "fecha"}
          />
        ) : (
          <p className="text-xs text-[var(--color-tinta-suave)]">
            La query no trae una columna de fecha reconocible, así que no se filtra por fechas. Si la tiene,
            elígela en «Fecha» más arriba.
          </p>
        )}

        <div
          className={`${masFiltros ? "grid" : "hidden"} gap-3 sm:grid sm:grid-cols-2 ${
            columnasGrid >= 4 ? "lg:grid-cols-4" : columnasGrid === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"
          }`}
        >
          {iConsultor >= 0 && (
            <div>
              <label htmlFor="query-datos-consultor" className="campo-etiqueta">
                {nombreBonito(mapeo.consultor ?? "Consultor")}
              </label>
              <select
                id="query-datos-consultor"
                value={consultor}
                onChange={(e) => filtrar(setConsultor)(e.target.value)}
                className="campo"
              >
                <option value="">Todos</option>
                {opcionesConsultor.map(([u, n]) => (
                  <option key={u} value={u}>
                    {u} ({cifra(n)})
                  </option>
                ))}
              </select>
            </div>
          )}
          {opcionesListas.map((c) => (
            <div key={c.nombre}>
              <label htmlFor={`query-datos-lista-${c.indice}`} className="campo-etiqueta">
                {nombreBonito(c.nombre)}
              </label>
              <select
                id={`query-datos-lista-${c.indice}`}
                value={filtros[c.nombre] ?? ""}
                onChange={(e) => filtrar(setFiltros)({ ...filtros, [c.nombre]: e.target.value })}
                className="campo"
              >
                <option value="">Todos</option>
                {c.valores.map(([v, n]) => (
                  <option key={v} value={v}>
                    {v.length > 60 ? `${v.slice(0, 60)}…` : v} ({cifra(n)})
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className={hayFiltrosExtra ? "sm:col-span-2 lg:col-span-1" : "sm:col-span-2 lg:col-span-2"}>
            <label htmlFor="query-datos-buscar" className="campo-etiqueta">
              Buscar
            </label>
            <input
              id="query-datos-buscar"
              type="search"
              value={busqueda}
              onChange={(e) => filtrar(setBusqueda)(e.target.value)}
              placeholder="Cualquier columna: código, PDV, consultor, respuesta…"
              className="campo"
            />
          </div>
        </div>

        <FiltrosActivos
          filtros={puestos}
          onQuitarTodo={quitarTodo}
          nota={
            vista.length === 0
              ? "No hay filas con esos filtros para descargar."
              : `El Excel trae ${vista.length === 1 ? "la fila" : `las ${cifra(vista.length)} filas`} que ves, con todas las columnas de la query.`
          }
        />
      </section>

      {/* ---------------------------------------------------------- cifras */}
      <section aria-label="Resumen" className={`grid grid-cols-2 gap-3 ${cifras.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        {cifras.map((c) => (
          <div key={c.nombre} className="tarjeta px-4 py-3.5 sm:px-5">
            <p className="text-[13px] text-[var(--color-tinta-suave)]">{c.nombre}</p>
            <p className="cifras mt-1 text-[24px] leading-tight font-semibold">
              {c.valor}{" "}
              {c.extra && <span className="text-[13px] font-normal text-[var(--color-tinta-suave)]">{c.extra}</span>}
            </p>
          </div>
        ))}
      </section>

      <div className={`grid items-start gap-5 ${grupoActual ? "lg:grid-cols-[272px_minmax(0,1fr)]" : ""}`}>
        {/* ---------------------------------------------------------- por columna */}
        {grupoActual && (
          <section aria-labelledby="query-datos-por" className="tarjeta px-3 py-4">
            <h2 id="query-datos-por" className="px-1.5 text-[15px] font-semibold">
              Por {nombreBonito(grupoActual).toLowerCase()}
            </h2>
            <p className="mt-0.5 mb-2.5 px-1.5 text-xs text-[var(--color-tinta-suave)]">
              Toca uno para ver solo esas filas.
            </p>
            {utiles.length > 1 && (
              <div className="mb-3 px-1.5">
                <label htmlFor="query-datos-agrupar" className="campo-etiqueta">
                  Agrupar por
                </label>
                <select
                  id="query-datos-agrupar"
                  value={grupoActual}
                  onChange={(e) => {
                    setAgrupar(e.target.value);
                    filtrar(setValorGrupo)(null);
                  }}
                  className="campo"
                >
                  {utiles.map((c) => (
                    <option key={c.nombre} value={c.nombre}>
                      {nombreBonito(c.nombre)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <ul className="max-h-[480px] space-y-0.5 overflow-y-auto">
              {grupos.map((g) => {
                const activo = valorGrupo === g.nombre;
                return (
                  <li key={g.nombre}>
                    <button
                      type="button"
                      aria-pressed={activo}
                      onClick={() => filtrar(setValorGrupo)(activo ? null : g.nombre)}
                      className={`flex w-full flex-col gap-1.5 rounded-[6px] px-2.5 py-2 text-left ${
                        activo ? "bg-[var(--color-acento)] text-[var(--color-sobre-acento)]" : "hover:bg-[var(--color-hover)]"
                      }`}
                    >
                      <span className="flex justify-between gap-3 text-[13px] leading-snug">
                        <span className="min-w-0 break-words">{g.nombre}</span>
                        <span className="cifras">{cifra(g.n)}</span>
                      </span>
                      <span
                        className={`block h-1.5 rounded-full ${
                          activo ? "bg-[color-mix(in_srgb,var(--color-sobre-acento)_25%,transparent)]" : "bg-[var(--color-fantasma)]"
                        }`}
                      >
                        <span
                          className={`block h-1.5 rounded-full ${activo ? "bg-[var(--color-sobre-acento)]" : "bg-[var(--color-acento)]"}`}
                          style={{ width: `${g.n === 0 ? 0 : Math.max(3, (g.n / maximo) * 100)}%` }}
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* ---------------------------------------------------------- tabla */}
        <section aria-labelledby="query-datos-tabla" className="tarjeta overflow-hidden">
          <div
            ref={inicioTabla}
            className="flex scroll-mt-24 flex-wrap items-center justify-between gap-2 border-b border-[var(--color-linea)] px-4 py-3.5 sm:px-5"
          >
            <div className="min-w-0">
              <h2 id="query-datos-tabla" className="text-[15px] font-semibold">
                Resultados
              </h2>
              <span className="text-xs text-[var(--color-tinta-suave)]">En el orden de la query</span>
            </div>
            <button type="button" onClick={descargar} disabled={vista.length === 0} className="boton boton-ambar">
              <Sheet size={16} aria-hidden />
              Excel
            </button>
          </div>

          {aviso && (
            <p className="flex items-center gap-2 border-b border-[var(--color-linea)] bg-[var(--color-aviso-fondo)] px-4 py-2.5 text-xs text-[var(--color-aviso-tinta)] sm:px-5">
              <TriangleAlert size={14} className="shrink-0" aria-hidden />
              {aviso}
            </p>
          )}

          {vista.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-[var(--color-tinta-suave)]">
              {enRango.length === 0 ? "No hay filas en esas fechas." : "Ninguna fila coincide con esos filtros."}
            </p>
          ) : (
            <>
              {/* Tabla en pantallas medianas y grandes. */}
              <div className="hidden overflow-x-auto md:block">
                <table className="tabla" style={{ minWidth: Math.min(Math.max(columnas.length * 150, 640), 1600) }}>
                  <thead>
                    <tr>
                      {columnas.map((c, k) => (
                        <th key={`${c}-${k}`} scope="col">
                          {nombreBonito(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((i) => (
                      <tr key={`${i}-${pag}`}>
                        {columnas.map((c, k) => (
                          <td
                            key={`${c}-${k}`}
                            className={`max-w-[260px] break-words ${k === iPdv ? "font-medium" : ""} ${
                              k === iFecha ? "cifras whitespace-nowrap" : ""
                            }`}
                          >
                            <Celda valor={crudas[i][k] ?? null} esFecha={k === iFecha} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tarjetas en el celular. */}
              <ul className="divide-y divide-[var(--color-linea)] md:hidden">
                {visibles.map((i) => (
                  <li key={`${i}-${pag}`} className="px-4 py-3">
                    <p className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-[14px] font-semibold break-words">
                        {valorDe(i, iTitulo) || "Sin nombre"}
                      </span>
                      {iFecha >= 0 && (
                        <span className="cifras shrink-0 text-xs text-[var(--color-tinta-suave)]">
                          {fechaLegible(crudas[i][iFecha]) ?? "Sin fecha"}
                        </span>
                      )}
                    </p>
                    <dl className="mt-1.5 space-y-1 text-[13px] leading-snug">
                      {columnas
                        .map((c, k) => [c, k] as const)
                        .filter(([, k]) => k !== iTitulo && k !== iFecha && valorDe(i, k) !== "")
                        .slice(0, 8)
                        .map(([c, k]) => (
                          <div key={`${c}-${k}`} className="flex gap-2">
                            <dt className="shrink-0 text-[var(--color-tinta-suave)]">{nombreBonito(c)}:</dt>
                            <dd className="min-w-0 break-words">
                              <Celda valor={crudas[i][k] ?? null} esFecha={false} />
                            </dd>
                          </div>
                        ))}
                    </dl>
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

      {/* Barra del celular: los filtros plegados, siempre a la mano. */}
      <div className="sticky bottom-0 z-20 -mx-4 flex gap-2.5 border-t border-[var(--color-linea)] bg-[var(--color-papel)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] md:hidden">
        <button
          type="button"
          aria-expanded={masFiltros}
          aria-controls="query-datos-filtros"
          onClick={() => {
            setMasFiltros((v) => !v);
            document.getElementById("query-datos-filtros")?.scrollIntoView({ behavior: "smooth" });
          }}
          className="boton boton-secundario"
        >
          <SlidersHorizontal size={16} aria-hidden />
          Filtros
        </button>
        <button type="button" onClick={descargar} disabled={vista.length === 0} className="boton boton-ambar flex-1">
          <Sheet size={16} aria-hidden />
          Excel
        </button>
      </div>
    </div>
  );
}
