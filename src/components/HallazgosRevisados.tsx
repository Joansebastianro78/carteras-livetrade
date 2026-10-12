"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Sheet, TriangleAlert, Undo2 } from "lucide-react";
import { exportarRevisados } from "@/lib/excel";
import {
  SIN_RANGO,
  cuando,
  dentroDelRango,
  diaDe,
  fechaLegible,
  hayRango,
  rangoAlReves,
  resumirFechas,
  sufijoRango,
  textoRango,
  type Rango,
} from "@/lib/fechas";
import type { HallazgoRevisado } from "@/lib/revisionHallazgos";
import EncabezadoPagina from "./EncabezadoPagina";
import FiltrosActivos, { type FiltroActivo } from "./FiltrosActivos";
import RangoFechas from "./RangoFechas";
import { cifra, sinTildes } from "./ConsultaAthena";

/**
 * Hallazgos revisados de la auditoría de datos: lo que alguien marcó como
 * revisado, con quién y cuándo, para llevar el control. Se lee de la base
 * (revision_hallazgos), no de Athena: no hay que volver a consultar nada.
 * Si un hallazgo vuelve a necesitar atención, se devuelve a pendientes y
 * sale otra vez en la auditoría.
 */

const POR_PAGINA = 50;

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** El día de la revisión, en la hora de este navegador (Colombia, para el equipo). */
const diaRevision = (r: HallazgoRevisado) => {
  const f = new Date(r.revisado_en);
  return Number.isNaN(f.getTime()) ? null : diaDe(f);
};

const quienDe = (r: HallazgoRevisado) => r.revisado_por ?? "Sin usuario";

/** Marca de lo que entró por la carga masiva; el nombre del archivo, al pasar el mouse. */
function CargaMasiva({ archivo }: { archivo: string }) {
  return (
    <span
      title={`Carga masiva: ${archivo}`}
      className="ml-1.5 inline-block rounded-full bg-[var(--color-info-fondo)] px-1.5 py-px align-baseline text-[11px] whitespace-nowrap text-[var(--color-info-tinta)]"
    >
      Carga masiva<span className="sr-only">: {archivo}</span>
    </span>
  );
}

export default function HallazgosRevisados() {
  const [lista, setLista] = useState<HallazgoRevisado[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "mal"; texto: string } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [devolviendo, setDevolviendo] = useState<string | null>(null);

  const [rango, setRango] = useState<Rango>(SIN_RANGO);
  const [motivo, setMotivo] = useState("");
  const [quien, setQuien] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(0);
  const inicioTabla = useRef<HTMLDivElement>(null);

  async function cargar() {
    setCargando(true);
    try {
      const r = await fetch("/api/admin/revision-hallazgos");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudieron leer los hallazgos revisados.");
      setLista((j.revisados ?? []) as HallazgoRevisado[]);
      setAviso(j.aviso ?? null);
    } catch (e) {
      setLista((antes) => antes ?? []);
      setMensaje({ tipo: "mal", texto: (e as Error).message });
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  function filtrar<T>(cambiar: (valor: T) => void) {
    return (valor: T) => {
      cambiar(valor);
      setPagina(0);
    };
  }

  // ------------------------------------------------------------ derivados
  const todos = useMemo(() => lista ?? [], [lista]);
  const fechas = useMemo(() => resumirFechas(todos, diaRevision, (r) => r.revisado_en), [todos]);
  const conRango = hayRango(rango);
  const alReves = rangoAlReves(rango);

  const indice = useMemo(
    () =>
      new Map(
        todos.map((r) => [
          r,
          sinTildes(
            [
              r.codigo_bavaria,
              r.pdv,
              r.consultor,
              r.departamento,
              r.provincia,
              r.pregunta,
              r.respuesta,
              r.tipo_linea,
              r.revisado_por,
              r.observacion,
              r.archivo,
            ]
              .filter(Boolean)
              .join(" ")
          ),
        ])
      ),
    [todos]
  );

  const opciones = useMemo(() => {
    const motivos = new Map<string, number>();
    const quienes = new Map<string, number>();
    for (const r of todos) {
      motivos.set(r.motivo ?? "Sin motivo", (motivos.get(r.motivo ?? "Sin motivo") ?? 0) + 1);
      quienes.set(quienDe(r), (quienes.get(quienDe(r)) ?? 0) + 1);
    }
    const ordenar = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
    return { motivos: ordenar(motivos), quienes: ordenar(quienes) };
  }, [todos]);

  const q = sinTildes(busqueda.trim());

  /** Lo que se ve, del revisado más reciente al más antiguo (así llega de la base). */
  const vista = useMemo(
    () =>
      todos.filter(
        (r) =>
          (!conRango || dentroDelRango(diaRevision(r), rango)) &&
          (!motivo || (r.motivo ?? "Sin motivo") === motivo) &&
          (!quien || quienDe(r) === quien) &&
          (!q || (indice.get(r) ?? "").includes(q))
      ),
    [todos, conRango, rango, motivo, quien, q, indice]
  );

  const hoy = diaDe(new Date());
  const cuentas = useMemo(
    () => ({
      hoy: vista.filter((r) => diaRevision(r) === hoy).length,
      quienes: new Set(vista.map(quienDe)).size,
      pdv: new Set(vista.map((r) => r.codigo_bavaria).filter(Boolean)).size,
    }),
    [vista, hoy]
  );

  const paginas = Math.max(1, Math.ceil(vista.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const visibles = vista.slice(pag * POR_PAGINA, (pag + 1) * POR_PAGINA);

  function irAPagina(n: number) {
    setPagina(n);
    inicioTabla.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ------------------------------------------------------------ acciones
  async function devolver(r: HallazgoRevisado) {
    if (
      !confirm(
        `¿Devolver a pendientes el hallazgo de ${r.pdv ?? r.codigo_bavaria ?? "este punto"}? Vuelve a salir en la auditoría de datos.`
      )
    ) {
      return;
    }
    setDevolviendo(r.clave);
    setMensaje(null);
    try {
      const res = await fetch("/api/admin/revision-hallazgos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claves: [r.clave] }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "No se pudo devolver a pendientes.");
      setLista((antes) => (antes ?? []).filter((x) => x.clave !== r.clave));
      setMensaje({
        tipo: "ok",
        texto: `Se devolvió a pendientes: ${r.pdv ?? r.codigo_bavaria ?? "el hallazgo"}. Sale otra vez en la auditoría cuando la vuelvas a consultar.`,
      });
    } catch (e) {
      setMensaje({ tipo: "mal", texto: (e as Error).message });
    } finally {
      setDevolviendo(null);
    }
  }

  function descargar() {
    try {
      exportarRevisados(vista, sufijoRango(rango));
    } catch {
      setMensaje({ tipo: "mal", texto: "No se pudo armar el Excel. Intenta de nuevo." });
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
  if (motivo) puestos.push({ id: "motivo", etiqueta: `Motivo: ${motivo}`, quitar: () => filtrar(setMotivo)("") });
  if (quien) puestos.push({ id: "quien", etiqueta: `Revisó: ${quien}`, quitar: () => filtrar(setQuien)("") });
  if (busqueda.trim()) puestos.push({ id: "busqueda", etiqueta: `«${busqueda.trim()}»`, quitar: () => filtrar(setBusqueda)("") });

  function quitarTodo() {
    setRango(SIN_RANGO);
    setMotivo("");
    setQuien("");
    setBusqueda("");
    setPagina(0);
  }

  const revisadoPor = (r: HallazgoRevisado) => (
    <>
      <span className="block whitespace-nowrap">{quienDe(r)}</span>
      <span className="cifras block text-xs whitespace-nowrap text-[var(--color-tinta-suave)]">
        {cuando(r.revisado_en)}
        {r.archivo && <CargaMasiva archivo={r.archivo} />}
      </span>
    </>
  );

  const botonDevolver = (r: HallazgoRevisado, ancho = false) => (
    <button
      type="button"
      onClick={() => devolver(r)}
      disabled={devolviendo !== null}
      title="Devolver a pendientes: vuelve a salir en la auditoría"
      aria-label={`Devolver a pendientes: ${r.pdv ?? r.codigo_bavaria ?? "hallazgo"}, ${r.motivo ?? ""}`}
      className={`boton boton-secundario boton-chico ${ancho ? "w-full" : ""}`}
    >
      {devolviendo === r.clave ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Undo2 size={14} aria-hidden />}
      Devolver
    </button>
  );

  // ------------------------------------------------------------ pantalla
  return (
    <div className="space-y-5">
      <EncabezadoPagina
        titulo="Hallazgos revisados"
        descripcion="Los hallazgos de la auditoría de datos que ya alguien revisó, con quién y cuándo. Si uno vuelve a necesitar atención, devuélvelo a pendientes."
        acciones={
          <>
            <button type="button" onClick={cargar} disabled={cargando} className="boton boton-secundario">
              {cargando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <RefreshCw size={16} aria-hidden />}
              Actualizar
            </button>
            {vista.length > 0 && (
              <button type="button" onClick={descargar} className="boton boton-ambar">
                <Sheet size={16} aria-hidden />
                Excel
              </button>
            )}
          </>
        }
      />

      {aviso && (
        <p className="flex items-start gap-2 rounded-[4px] bg-[var(--color-aviso-fondo)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-aviso-tinta)]">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
          {aviso}
        </p>
      )}

      {mensaje && (
        <p
          role="status"
          className={`rounded-[4px] px-3 py-2.5 text-[13px] leading-snug ${
            mensaje.tipo === "ok"
              ? "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]"
              : "bg-[var(--color-alerta-fondo)] text-[var(--color-alerta)]"
          }`}
        >
          {mensaje.texto}
        </p>
      )}

      {lista === null ? (
        <p className="flex items-center gap-2 text-sm text-[var(--color-tinta-suave)]">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          Cargando…
        </p>
      ) : todos.length === 0 ? (
        !aviso && (
          <p className="rounded-[4px] border border-dashed border-[var(--color-linea)] px-4 py-8 text-center text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
            Todavía no hay hallazgos revisados. En Auditorías › Datos, el botón «Revisado» de cada
            hallazgo, o la carga masiva con un Excel, los saca de la lista y los trae aquí.
          </p>
        )
      ) : (
        <>
          {/* ---------------------------------------------------------- filtros */}
          <section aria-label="Filtros" className="tarjeta space-y-4 px-4 py-4 sm:px-5">
            <RangoFechas
              id="revisados"
              rango={rango}
              onCambiar={filtrar(setRango)}
              fechas={fechas}
              uno="revisión"
              varios="revisiones"
              femenino
              columna="fecha de revisión"
            />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr]">
              <div>
                <label htmlFor="revisados-motivo" className="campo-etiqueta">
                  Motivo
                </label>
                <select id="revisados-motivo" value={motivo} onChange={(e) => filtrar(setMotivo)(e.target.value)} className="campo">
                  <option value="">Todos los motivos</option>
                  {opciones.motivos.map(([m, n]) => (
                    <option key={m} value={m}>
                      {m} ({cifra(n)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="revisados-quien" className="campo-etiqueta">
                  Revisado por
                </label>
                <select id="revisados-quien" value={quien} onChange={(e) => filtrar(setQuien)(e.target.value)} className="campo">
                  <option value="">Todos</option>
                  {opciones.quienes.map(([u, n]) => (
                    <option key={u} value={u}>
                      {u} ({cifra(n)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <label htmlFor="revisados-buscar" className="campo-etiqueta">
                  Buscar
                </label>
                <input
                  id="revisados-buscar"
                  type="search"
                  value={busqueda}
                  onChange={(e) => filtrar(setBusqueda)(e.target.value)}
                  placeholder="Código, PDV, consultor, respuesta, observación o archivo"
                  className="campo"
                />
              </div>
            </div>

            <FiltrosActivos
              filtros={puestos}
              onQuitarTodo={quitarTodo}
              nota={vista.length > 0 ? "El Excel trae lo que ves, con todos los filtros." : undefined}
            />
          </section>

          {/* ---------------------------------------------------------- cifras */}
          <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { nombre: "Revisados", valor: cifra(vista.length), extra: vista.length !== todos.length ? `de ${cifra(todos.length)}` : null },
              { nombre: "Revisados hoy", valor: cifra(cuentas.hoy), extra: null },
              { nombre: "Personas que revisaron", valor: cifra(cuentas.quienes), extra: null },
              { nombre: "PDV", valor: cifra(cuentas.pdv), extra: null },
            ].map((c) => (
              <div key={c.nombre} className="tarjeta px-4 py-3.5 sm:px-5">
                <p className="text-[13px] text-[var(--color-tinta-suave)]">{c.nombre}</p>
                <p className="cifras mt-1 text-[24px] leading-tight font-semibold">
                  {c.valor}{" "}
                  {c.extra && <span className="text-[13px] font-normal text-[var(--color-tinta-suave)]">{c.extra}</span>}
                </p>
              </div>
            ))}
          </section>

          {/* ---------------------------------------------------------- lista */}
          <section aria-labelledby="lista-revisados" className="tarjeta overflow-hidden">
            <div
              ref={inicioTabla}
              className="flex scroll-mt-24 flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-linea)] px-4 py-3.5 sm:px-5"
            >
              <h2 id="lista-revisados" className="text-[15px] font-semibold">
                Revisados
              </h2>
              <span className="text-xs text-[var(--color-tinta-suave)]">Del revisado más reciente al más antiguo</span>
            </div>

            {vista.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-[var(--color-tinta-suave)]">
                Ningún hallazgo revisado coincide con esos filtros.
              </p>
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="tabla min-w-[900px]">
                    <thead>
                      <tr>
                        <th scope="col">PDV</th>
                        <th scope="col">Pregunta</th>
                        <th scope="col">Respuesta</th>
                        <th scope="col">Motivo</th>
                        <th scope="col">Consultor y fecha</th>
                        <th scope="col">Revisado</th>
                        <th scope="col">
                          <span className="sr-only">Devolver</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibles.map((r) => (
                        <tr key={r.clave}>
                          <td className="max-w-[200px]">
                            <span className="block font-medium">{r.pdv ?? "PDV sin nombre"}</span>
                            <span className="cifras block text-xs text-[var(--color-tinta-suave)]">
                              {[r.codigo_bavaria, r.tipo_linea].filter(Boolean).join(" · ")}
                            </span>
                          </td>
                          <td className="max-w-[240px] text-[var(--color-tinta-suave)]">{r.pregunta ?? "Sin pregunta"}</td>
                          <td className="max-w-[150px] font-medium break-words">
                            {r.respuesta ?? <span className="font-normal text-[var(--color-alerta)]">Sin respuesta</span>}
                          </td>
                          <td className="max-w-[160px]">
                            <span className="inline-block rounded-[10px] bg-[var(--color-exito-fondo)] px-2 py-0.5 text-xs leading-snug text-[var(--color-exito)]">
                              {r.motivo ?? "Sin motivo"}
                            </span>
                          </td>
                          <td className="whitespace-nowrap">
                            <span className="block">{r.consultor ?? "—"}</span>
                            <span className="cifras block text-xs text-[var(--color-tinta-suave)]">
                              {fechaLegible(r.fecha_hallazgo) ?? "Sin fecha"}
                            </span>
                          </td>
                          <td className="max-w-[240px]">
                            {revisadoPor(r)}
                            {r.observacion && (
                              <span className="mt-1 block text-xs leading-snug break-words">«{r.observacion}»</span>
                            )}
                          </td>
                          <td className="w-[1%] whitespace-nowrap text-right">{botonDevolver(r)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <ul className="divide-y divide-[var(--color-linea)] md:hidden">
                  {visibles.map((r) => (
                    <li key={r.clave} className="px-4 py-3">
                      <p className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 text-[14px] font-semibold">{r.pdv ?? "PDV sin nombre"}</span>
                        <span className="cifras shrink-0 text-xs text-[var(--color-tinta-suave)]">
                          {fechaLegible(r.fecha_hallazgo) ?? "Sin fecha"}
                        </span>
                      </p>
                      <p className="mt-1 text-[13px] leading-snug text-[var(--color-tinta-suave)]">{r.pregunta ?? "Sin pregunta"}</p>
                      <p className="mt-1 text-[14px] break-words">
                        {r.respuesta ? (
                          <>
                            Respuesta: <b className="font-semibold">{r.respuesta}</b>
                          </>
                        ) : (
                          <span className="text-[var(--color-alerta)]">Sin respuesta</span>
                        )}
                      </p>
                      <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
                        <span className="rounded-full bg-[var(--color-exito-fondo)] px-2 py-0.5 text-[var(--color-exito)]">
                          {r.motivo ?? "Sin motivo"}
                        </span>
                        {r.consultor && <span className="rounded-full bg-[var(--color-relleno)] px-2 py-0.5">{r.consultor}</span>}
                        {r.codigo_bavaria && (
                          <span className="cifras rounded-full bg-[var(--color-relleno)] px-2 py-0.5">{r.codigo_bavaria}</span>
                        )}
                      </p>
                      <p className="mt-2 text-xs text-[var(--color-tinta-suave)]">
                        Revisado por <b className="font-semibold text-[var(--color-tinta)]">{quienDe(r)}</b> · {cuando(r.revisado_en)}
                        {r.archivo && <CargaMasiva archivo={r.archivo} />}
                      </p>
                      {r.observacion && <p className="mt-1 text-[13px] leading-snug break-words">«{r.observacion}»</p>}
                      <div className="mt-3">{botonDevolver(r, true)}</div>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-linea)] px-4 py-3 sm:px-5">
                  <span className="cifras text-[13px] text-[var(--color-tinta-suave)]">
                    {cifra(pag * POR_PAGINA + 1)}–{cifra(Math.min((pag + 1) * POR_PAGINA, vista.length))} de {cifra(vista.length)}
                  </span>
                  {paginas > 1 && (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => irAPagina(pag - 1)} disabled={pag === 0} className="boton boton-secundario boton-chico">
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
        </>
      )}
    </div>
  );
}
