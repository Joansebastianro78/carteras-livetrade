"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CopyPlus, Play, Save, Trash2, TriangleAlert } from "lucide-react";
import { fotosDe, ordenarPorFecha } from "@/lib/imagenesAuditoria";
import {
  detalleDeQuery,
  detectarColumnas,
  exportadorDeQuery,
  filasDeQuery,
  filtrosDeQuery,
  resolverMapeo,
} from "@/lib/fotosQuery";
import { MAX_NOMBRE_QUERY, NOMBRE_ROL, ROLES, type Mapeo, type QueryGuardada } from "@/lib/queriesFotos";
import { revisarSql } from "@/lib/sqlSoloLectura";
import EncabezadoPagina from "./EncabezadoPagina";
import GaleriaFotos from "./GaleriaFotos";
import VistaDatosQuery from "./VistaDatosQuery";
import { BotonReconsultar, ProgresoConsulta, cifra, textoConsulta, useConsultaAthena } from "./ConsultaAthena";

/**
 * Auditoría con query: corre la query que se elija o se escriba aquí y la
 * muestra según lo que traiga:
 *
 *   - Con una columna de enlaces de fotos: la misma revisión de fotos de la
 *     auditoría de imágenes (galería, marcas, repetidas, IA).
 *   - Sin fotos (respuestas de formularios, cobertura...): una vista de datos
 *     como la de la auditoría de datos, con fechas, filtros, cifras, barras
 *     por columna, tabla y Excel.
 *
 * Si trae las dos cosas, arranca en fotos y un selector deja pasar a datos.
 *
 * Quien tiene «Auditoría con query» elige una query guardada y la corre.
 * Quien tiene además «Escribir queries» la escribe, la prueba, la guarda, la
 * cambia o la borra. El servidor revisa el SQL (solo lectura, una sentencia)
 * y el permiso de nuevo: lo de esta pantalla es para avisar a tiempo.
 */

const RECORDAR = "auditoria-query:elegida";

const EJEMPLO = `-- Fotos: trae una columna con el enlace de la foto
SELECT nombre_pdv, nombre_usuario, cod_personalizado,
       foto_visita_inicio, fecha_inicio
FROM dim_lf_general_cobertura
WHERE campana_id = 2423
  AND inicio_visita_id IS NOT NULL

-- Datos: cualquier columna, sin fotos
-- SELECT d.nombre_usuario, d.componente_etiqueta, d.componente_valor, d.fecha
-- FROM dim_lf_general_datos d WHERE d.actividad_id = 13985`;

type Corrida = {
  cuerpo: Record<string, unknown>;
  nombre: string;
  /** La query guardada de la que salió; null si era una nueva sin guardar. */
  queryId: number | null;
};

type Mensaje = { tipo: "ok" | "error"; texto: string };

const sinFinal = (s: string) => s.replace(/\s+$/, "");

function leerRecordada(): number | null {
  try {
    const v = Number(window.localStorage.getItem(RECORDAR));
    return Number.isSafeInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function recordar(id: number | null) {
  try {
    if (id === null) window.localStorage.removeItem(RECORDAR);
    else window.localStorage.setItem(RECORDAR, String(id));
  } catch {
    // Sin almacenamiento solo se pierde la comodidad de volver a la misma query.
  }
}

export default function AuditoriaQuery() {
  // ------------------------------------------------------------ queries guardadas
  const [lista, setLista] = useState<QueryGuardada[]>([]);
  const [cargaLista, setCargaLista] = useState<"cargando" | "lista" | "error">("cargando");
  const [avisoLista, setAvisoLista] = useState<string | null>(null);
  const [puedeEditar, setPuedeEditar] = useState(false);

  /** La query elegida en la lista; null es «Nueva query». */
  const [elegidaId, setElegidaId] = useState<number | null>(null);
  const [nombre, setNombre] = useState("");
  const [sql, setSql] = useState("");
  /** El error del SQL se muestra después de intentar correrlo o guardarlo. */
  const [tocado, setTocado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);

  const elegida = elegidaId === null ? null : (lista.find((q) => q.id === elegidaId) ?? null);

  const cargarEnEditor = useCallback((q: QueryGuardada | null) => {
    setElegidaId(q?.id ?? null);
    setNombre(q?.nombre ?? "");
    setSql(q?.sql ?? "");
    setTocado(false);
    recordar(q?.id ?? null);
  }, []);

  useEffect(() => {
    fetch("/api/admin/queries-fotos")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? "No se pudieron leer las queries guardadas.");
        const queries: QueryGuardada[] = j.queries ?? [];
        setLista(queries);
        setAvisoLista(j.aviso ?? null);
        setPuedeEditar(j.puedeEditar === true);
        const recordada = leerRecordada();
        const inicial = queries.find((q) => q.id === recordada) ?? (j.puedeEditar === true ? null : (queries[0] ?? null));
        cargarEnEditor(inicial);
        setCargaLista("lista");
      })
      .catch((e) => {
        setAvisoLista((e as Error).message);
        setCargaLista("error");
      });
  }, [cargarEnEditor]);

  /** Lo escrito no es lo guardado. */
  const sucio = puedeEditar
    ? elegida
      ? elegida.nombre !== nombre.replace(/\s+/g, " ").trim() || sinFinal(elegida.sql) !== sinFinal(sql)
      : sql.trim() !== "" || nombre.trim() !== ""
    : false;

  const revision = useMemo(() => revisarSql(sql), [sql]);

  // ------------------------------------------------------------ correr
  const [columnas, setColumnas] = useState<string[]>([]);
  const aFilas = useCallback((cols: string[], filas: (string | null)[][]) => {
    setColumnas((antes) => (antes.length === cols.length && antes.every((c, i) => c === cols[i]) ? antes : cols));
    return filas;
  }, []);
  const {
    fase,
    filas: crudas,
    info,
    consultar,
    trabajando,
  } = useConsultaAthena<(string | null)[]>("/api/admin/auditoria-query", aFilas, { automatica: false });

  const [corrida, setCorrida] = useState<Corrida | null>(null);
  /** Cómo se ve el resultado cuando la query trae fotos; null es lo de siempre (fotos). */
  const [vistaElegida, setVistaElegida] = useState<"fotos" | "datos" | null>(null);
  /** Columnas cambiadas a mano después de correr. */
  const [elegidas, setElegidas] = useState<Partial<Mapeo>>({});

  function correr() {
    setMensaje(null);
    let nueva: Corrida;
    if (puedeEditar) {
      setTocado(true);
      if (!revision.ok) return;
      nueva = {
        cuerpo: { sql },
        nombre: nombre.replace(/\s+/g, " ").trim() || "Query sin guardar",
        queryId: elegidaId,
      };
    } else {
      if (!elegida) return;
      nueva = { cuerpo: { query: elegida.id }, nombre: elegida.nombre, queryId: elegida.id };
    }
    setCorrida(nueva);
    setElegidas({});
    setVistaElegida(null);
    setColumnas([]);
    consultar(false, nueva.cuerpo);
  }

  function reconsultar(fresca: boolean) {
    if (corrida) consultar(fresca, corrida.cuerpo);
  }

  // ------------------------------------------------------------ columnas
  const listo = fase.tipo === "listo";
  const guardadaCorrida = corrida?.queryId != null ? (lista.find((q) => q.id === corrida.queryId) ?? null) : null;
  const detectado = useMemo(() => detectarColumnas(columnas, crudas), [columnas, crudas]);
  const sinElegir = resolverMapeo(columnas, detectado, guardadaCorrida?.columnas ?? null, {});
  const calculado = resolverMapeo(columnas, detectado, guardadaCorrida?.columnas ?? null, elegidas);
  // La galería se rearma (y limpia sus filtros) solo si de verdad cambian las columnas.
  const claveMapeo = JSON.stringify(ROLES.map((r) => calculado[r]));
  const mapeo = useMemo<Mapeo>(() => {
    const v = JSON.parse(claveMapeo) as (string | null)[];
    return Object.fromEntries(ROLES.map((r, i) => [r, v[i]])) as Mapeo;
  }, [claveMapeo]);
  const columnasCambiadas = ROLES.some((r) => calculado[r] !== sinElegir[r]);
  /**
   * Qué trae de verdad la columna de fotos: celdas con enlace y celdas con
   * otra cosa (respuestas, fechas, números). Una query de formularios puede
   * dejar marcada como «Foto» una columna que casi nunca trae enlaces.
   */
  const conteoFoto = useMemo(() => {
    let enlaces = 0;
    let texto = 0;
    const i = mapeo.foto === null ? -1 : columnas.indexOf(mapeo.foto);
    if (i >= 0) {
      for (const f of crudas) {
        const v = (f[i] ?? "").trim();
        if (!v) continue;
        if (fotosDe(v).length > 0) enlaces++;
        else texto++;
      }
    }
    return { enlaces, texto };
  }, [columnas, crudas, mapeo.foto]);
  /** Hay galería solo si la columna elegida trae al menos un enlace. */
  const hayFotos = mapeo.foto !== null && conteoFoto.enlaces > 0;
  /** Sin fotos solo hay datos; con ellas, fotos salvo que se elija datos. */
  const modo: "fotos" | "datos" = !hayFotos ? "datos" : (vistaElegida ?? "fotos");

  const filas = useMemo(
    () =>
      mapeo.foto === null
        ? []
        : // Una celda con texto que no es enlace no es una visita sin foto: es otra respuesta
          // de la query. Se queda fuera de la galería y sigue en «Ver datos» y en el Excel.
          ordenarPorFecha(filasDeQuery(columnas, crudas, mapeo)).filter((f) => f.estado !== "no_es_enlace"),
    [columnas, crudas, mapeo]
  );
  const detalle = useMemo(() => detalleDeQuery(columnas, mapeo), [columnas, mapeo]);
  const filtrosColumna = useMemo(() => filtrosDeQuery(columnas, crudas, mapeo), [columnas, crudas, mapeo]);
  const exportar = useMemo(
    () => exportadorDeQuery(columnas, mapeo, corrida?.nombre ?? "query"),
    [columnas, mapeo, corrida?.nombre]
  );
  const opciones = useMemo(() => [...new Set(columnas)], [columnas]);

  // ------------------------------------------------------------ guardar y borrar
  function elegir(valor: string) {
    if (sucio && !confirm("Tienes cambios sin guardar en esta query. ¿Descartarlos?")) return;
    setMensaje(null);
    cargarEnEditor(valor === "nueva" ? null : (lista.find((q) => q.id === Number(valor)) ?? null));
  }

  async function guardar(comoNueva: boolean) {
    setMensaje(null);
    setTocado(true);
    if (!revision.ok) return;
    const limpio = nombre.replace(/\s+/g, " ").trim();
    if (!limpio) {
      setMensaje({ tipo: "error", texto: "Ponle un nombre a la query para guardarla." });
      document.getElementById("query-nombre")?.focus();
      return;
    }
    const nueva = comoNueva || elegidaId === null;
    if (comoNueva && elegida && limpio.toLowerCase() === elegida.nombre.toLowerCase()) {
      setMensaje({ tipo: "error", texto: "Cámbiale el nombre para guardarla como una query nueva." });
      document.getElementById("query-nombre")?.focus();
      return;
    }
    // Si lo que está en pantalla salió de esta query, se guardan esas columnas.
    const desdePantalla = listo && columnas.length > 0 && corrida !== null && corrida.queryId === elegidaId;
    const columnasGuardar = desdePantalla ? mapeo : (elegida?.columnas ?? {});

    setGuardando(true);
    try {
      const r = await fetch("/api/admin/queries-fotos", {
        method: nueva ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: nueva ? undefined : elegidaId, nombre: limpio, sql, columnas: columnasGuardar }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo guardar la query.");
      const q = j.query as QueryGuardada;
      setLista((antes) =>
        [...antes.filter((x) => x.id !== q.id), q].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
      );
      if (desdePantalla) {
        setCorrida((c) => (c ? { ...c, queryId: q.id, nombre: q.nombre } : c));
        setElegidas({});
      }
      cargarEnEditor(q);
      setMensaje({ tipo: "ok", texto: nueva ? `Query «${q.nombre}» guardada.` : "Cambios guardados." });
    } catch (e) {
      setMensaje({ tipo: "error", texto: (e as Error).message });
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!elegida) return;
    if (!confirm(`¿Borrar la query «${elegida.nombre}»? No se puede deshacer. Las marcas de las fotos no se borran.`)) return;
    setMensaje(null);
    setGuardando(true);
    try {
      const r = await fetch(`/api/admin/queries-fotos?id=${elegida.id}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "No se pudo borrar la query.");
      const borrada = elegida;
      setLista((antes) => antes.filter((x) => x.id !== borrada.id));
      setCorrida((c) => (c && c.queryId === borrada.id ? { ...c, queryId: null } : c));
      cargarEnEditor(null);
      setMensaje({ tipo: "ok", texto: `Query «${borrada.nombre}» borrada.` });
    } catch (e) {
      setMensaje({ tipo: "error", texto: (e as Error).message });
    } finally {
      setGuardando(false);
    }
  }

  // ------------------------------------------------------------ pantalla
  const puedeCorrer = puedeEditar ? sql.trim() !== "" : elegida !== null;
  /** El editor crece con la query, para que la galería no quede muy abajo. */
  const filasEditor = sql ? Math.min(16, Math.max(4, sql.split("\n").length + 1)) : 6;

  const editor = (
    <section aria-label="Query" className="tarjeta space-y-4 px-4 py-4 sm:px-5">
      {cargaLista === "cargando" ? (
        <p className="text-[13px] text-[var(--color-tinta-suave)]">Cargando las queries guardadas…</p>
      ) : (
        <>
          <div className={`grid gap-3 ${puedeEditar ? "sm:grid-cols-2" : "sm:max-w-lg"}`}>
            <div>
              <label htmlFor="query-elegida" className="campo-etiqueta">
                {puedeEditar ? "Query" : "Query guardada"}
              </label>
              <select
                id="query-elegida"
                value={elegidaId === null ? "nueva" : String(elegidaId)}
                onChange={(e) => elegir(e.target.value)}
                disabled={trabajando || (!puedeEditar && lista.length === 0)}
                className="campo"
              >
                {puedeEditar && <option value="nueva">Nueva query</option>}
                {!puedeEditar && lista.length === 0 && <option value="nueva">No hay queries guardadas</option>}
                {lista.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.nombre}
                  </option>
                ))}
              </select>
            </div>
            {puedeEditar && (
              <div>
                <label htmlFor="query-nombre" className="campo-etiqueta">
                  Nombre
                </label>
                <input
                  id="query-nombre"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  maxLength={MAX_NOMBRE_QUERY}
                  placeholder="Ej.: Fotos de cierre de visita"
                  autoComplete="off"
                  className="campo"
                />
              </div>
            )}
          </div>

          {puedeEditar ? (
            <div>
              <label htmlFor="query-sql" className="campo-etiqueta">
                SQL de Athena
              </label>
              <textarea
                id="query-sql"
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                onKeyDown={(e) => {
                  // Ctrl/Cmd + Enter corre la query, como en DBeaver.
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !trabajando) {
                    e.preventDefault();
                    correr();
                  }
                }}
                rows={filasEditor}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder={EJEMPLO}
                aria-describedby="query-sql-ayuda"
                aria-invalid={tocado && !revision.ok}
                className="campo py-2 font-mono leading-relaxed"
              />
              {tocado && !revision.ok ? (
                <p id="query-sql-ayuda" role="alert" className="mt-1.5 flex items-start gap-1.5 text-[13px] text-[var(--color-alerta)]">
                  <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
                  {revision.error}
                </p>
              ) : (
                <p id="query-sql-ayuda" className="mt-1.5 text-[12.5px] leading-snug text-[var(--color-tinta-suave)]">
                  Solo SELECT o WITH, una query a la vez. Si trae una columna con el enlace de la foto se ve la
                  galería; si no, una tabla de datos con filtros y Excel. La fecha, el PDV, el consultor y el código
                  se reconocen solos y se pueden cambiar después de correrla. Ctrl + Enter la corre.
                </p>
              )}
            </div>
          ) : (
            elegida && (
              <details>
                <summary className="cursor-pointer text-[13.5px] font-medium">Ver el SQL</summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-relleno)] px-3 py-2.5 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap">
                  {elegida.sql}
                </pre>
              </details>
            )
          )}

          {!puedeEditar && lista.length === 0 && cargaLista === "lista" && !avisoLista && (
            <p className="text-[13px] text-[var(--color-tinta-suave)]">
              Todavía no hay queries guardadas. Las crea quien tenga «Escribir queries» en su perfil.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={correr} disabled={trabajando || !puedeCorrer} className="boton boton-primario">
              <Play size={15} aria-hidden />
              Correr
            </button>
            {puedeEditar && (
              <>
                <button
                  type="button"
                  onClick={() => guardar(false)}
                  disabled={guardando || (!sucio && !(elegida && columnasCambiadas && corrida?.queryId === elegida.id))}
                  className="boton boton-secundario"
                >
                  <Save size={15} aria-hidden />
                  {elegida ? "Guardar cambios" : "Guardar"}
                </button>
                {elegida && (
                  <>
                    <button type="button" onClick={() => guardar(true)} disabled={guardando} className="boton boton-secundario">
                      <CopyPlus size={15} aria-hidden />
                      Guardar como nueva
                    </button>
                    <button
                      type="button"
                      onClick={borrar}
                      disabled={guardando}
                      className="boton boton-secundario text-[var(--color-alerta)]"
                    >
                      <Trash2 size={15} aria-hidden />
                      Borrar
                    </button>
                  </>
                )}
                {sucio && elegida && (
                  <span className="text-[12.5px] text-[var(--color-tinta-suave)]">Cambios sin guardar</span>
                )}
              </>
            )}
          </div>

          {elegida?.actualizado_por && (
            <p className="text-xs text-[var(--color-tinta-suave)]">Guardada por {elegida.actualizado_por}</p>
          )}
        </>
      )}

      {mensaje && (
        <p
          role={mensaje.tipo === "error" ? "alert" : "status"}
          className={`rounded-[4px] px-3 py-2 text-[13px] ${
            mensaje.tipo === "error"
              ? "bg-[var(--color-alerta-fondo)] text-[var(--color-alerta)]"
              : "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]"
          }`}
        >
          {mensaje.texto}
        </p>
      )}
      {avisoLista && (
        <p className="flex items-start gap-2 rounded-[4px] bg-[var(--color-aviso-fondo)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-aviso-tinta)]">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
          {avisoLista}
        </p>
      )}
    </section>
  );

  const selectorColumnas = listo && columnas.length > 0 && (
    <section aria-label="Columnas de la query" className="tarjeta px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-semibold">Columnas</h2>
        <p className="cifras text-[12.5px] text-[var(--color-tinta-suave)]">
          {cifra(crudas.length)} {crudas.length === 1 ? "fila" : "filas"} · {cifra(columnas.length)}{" "}
          {columnas.length === 1 ? "columna" : "columnas"}. Se reconocen solas; si alguna no es, cámbiala.
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {ROLES.map((rol) => (
          <div key={rol} className={rol === "foto" ? "col-span-2 sm:col-span-1" : undefined}>
            <label htmlFor={`query-col-${rol}`} className="campo-etiqueta">
              {NOMBRE_ROL[rol]}
            </label>
            <select
              id={`query-col-${rol}`}
              value={mapeo[rol] ?? ""}
              onChange={(e) => setElegidas((m) => ({ ...m, [rol]: e.target.value || null }))}
              className="campo"
            >
              <option value="">Ninguna</option>
              {opciones.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {crudas.length > 0 && mapeo.foto === null && (
        <p className="mt-3 text-[12.5px] leading-snug text-[var(--color-tinta-suave)]">
          Ninguna columna trae enlaces de fotos, así que el resultado se ve como tabla de datos. Si alguna columna
          trae los enlaces (http o https), elígela en «Foto» para ver la galería.
        </p>
      )}
      {crudas.length > 0 && mapeo.foto !== null && conteoFoto.enlaces === 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-[4px] bg-[var(--color-aviso-fondo)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-aviso-tinta)]">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            La columna «{mapeo.foto}» no trae ningún enlace de foto (http o https): trae {cifra(conteoFoto.texto)}{" "}
            {conteoFoto.texto === 1 ? "valor" : "valores"} de otro tipo. Por eso se ve como tabla de datos. Si los
            enlaces están en otra columna, elígela en «Foto»; si la query no los trae, hay que agregarlos al SELECT.
          </span>
        </p>
      )}
      {hayFotos && conteoFoto.texto > 0 && (
        <p className="mt-3 text-[12.5px] leading-snug text-[var(--color-tinta-suave)]">
          {cifra(conteoFoto.enlaces)} {conteoFoto.enlaces === 1 ? "fila trae" : "filas traen"} enlace de foto y{" "}
          {cifra(conteoFoto.texto)} traen otro valor en «{mapeo.foto}»: esas no salen en la galería, pero están en «Ver
          datos» y en el Excel.
        </p>
      )}
      {puedeEditar && elegida && corrida?.queryId === elegida.id && columnasCambiadas && (
        <p className="mt-3 text-[12.5px] text-[var(--color-tinta-suave)]">
          Dale «Guardar cambios» para que la query recuerde estas columnas.
        </p>
      )}
    </section>
  );

  const botonVista = listo && hayFotos && (
    <div role="group" aria-label="Cómo ver el resultado" className="flex gap-1.5">
      {(["fotos", "datos"] as const).map((v) => (
        <button key={v} type="button" aria-pressed={modo === v} onClick={() => setVistaElegida(v)} className="chip">
          {v === "fotos" ? "Ver fotos" : "Ver datos"}
        </button>
      ))}
    </div>
  );
  const acciones = (
    <>
      {botonVista}
      {corrida && <BotonReconsultar trabajando={trabajando} onConsultar={() => reconsultar(true)} />}
    </>
  );
  const descripcionCorrida =
    corrida && info
      ? `${corrida.nombre} · ${textoConsulta(info)}`
      : "Corre una query de Athena: si trae fotos las revisas como en la auditoría de imágenes; si no, ves los datos con filtros y Excel.";

  // Sin fotos (o si se pidió ver datos): la vista de datos.
  if (listo && columnas.length > 0 && modo === "datos") {
    return (
      <div className="space-y-5">
        <EncabezadoPagina titulo="Auditoría con query" descripcion={descripcionCorrida} acciones={acciones} />
        {editor}
        {selectorColumnas}
        <VistaDatosQuery columnas={columnas} crudas={crudas} mapeo={mapeo} nombre={corrida?.nombre ?? "query"} />
      </div>
    );
  }

  return (
    <GaleriaFotos
      prefijo="query"
      titulo="Auditoría con query"
      descripcion={descripcionCorrida}
      acciones={corrida || botonVista ? acciones : null}
      arriba={
        <>
          {editor}
          <ProgresoConsulta fase={fase} onReintentar={() => reconsultar(false)} />
          {selectorColumnas}
        </>
      }
      fase={fase}
      filas={filas}
      // Sin columna de foto, el aviso ya está junto a las columnas.
      vacio={crudas.length === 0 ? "La query no trajo filas." : ""}
      columnaFecha="fecha"
      nombreFecha="Fecha"
      queFoto="Foto"
      exportar={exportar}
      detalle={detalle}
      filtrosColumna={filtrosColumna}
      repetidas
      etiquetasIA
      nombreFotos={`Fotos_${corrida?.nombre ?? "query"}`}
    />
  );
}
