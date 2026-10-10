"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin, Search, Sheet, TriangleAlert } from "lucide-react";
import MapaTerritorioCliente from "./MapaTerritorioCliente";
import { exportarTerritorio } from "@/lib/excel";
import { COLORES_RUTA } from "@/lib/tipos";
import {
  COLUMNAS_EXCEL_TERRITORIO,
  SIN_DATO,
  TODOS_LOS_DEPARTAMENTOS,
  claveGrupo,
  nombreCiudad,
  nombreDepartamento,
  type Agrupacion,
  type DepartamentoResumen,
  type PuntoTerritorio,
  type RespuestaResumenTerritorio,
  type SeleccionPunto,
} from "@/lib/territorio";

/** Valor de los select para "sin filtro". */
const TODOS = "";
/** Separa departamento y ciudad en el valor del select de ciudad. La clave nunca trae tabuladores. */
const SEP = "\t";
const POR_PAGINA = 50;
/** Más que esto ya no cabe con holgura en el navegador: hay que acotar. */
const TOPE_PUNTOS = 30_000;
const COLOR_OTRAS = "#6B7B80";

type Filtro = { departamento: string; ciudad: string; ciclo: string };

type Resultado = {
  filtro: Filtro;
  titulo: string;
  subtitulo: string | null;
  puntos: PuntoTerritorio[];
  total: number | null;
  cargados: number;
  cargando: boolean;
  /** Solo con todas las páginas leídas se puede descargar. */
  completo: boolean;
  aviso: string | null;
  error: string | null;
};

const cifra = (n: number) => n.toLocaleString("es-CO");

const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function esLibre(p: PuntoTerritorio): boolean {
  return p.usuario === "LIBRE" || p.ccuser === "LIBRE";
}

function etiquetaCiclo(c: string): string {
  return c === "" || c === SIN_DATO ? "Sin ciclo" : `Ciclo ${c}`;
}

export default function FiltroTerritorio() {
  const [resumen, setResumen] = useState<RespuestaResumenTerritorio | null>(null);
  const [cargandoResumen, setCargandoResumen] = useState(true);
  const [errorResumen, setErrorResumen] = useState<string | null>(null);

  const [ciclo, setCiclo] = useState(TODOS);
  const [departamento, setDepartamento] = useState(TODOS);
  const [ciudad, setCiudad] = useState(TODOS);

  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [visibles, setVisibles] = useState(POR_PAGINA);
  const [seleccionado, setSeleccionado] = useState<SeleccionPunto | null>(null);

  const consulta = useRef(0);
  const mapaRef = useRef<HTMLDivElement>(null);

  // ------------------------------------------------------- lista de regiones
  // Los conteos cambian con el ciclo, así que se vuelve a pedir al cambiarlo.
  useEffect(() => {
    let vigente = true;

    (async () => {
      setCargandoResumen(true);
      setErrorResumen(null);

      const params = new URLSearchParams({ resumen: "1" });
      if (ciclo !== TODOS) params.set("ciclo", ciclo);

      try {
        const res = await fetch(`/api/admin/territorio?${params}`);
        const json = await res.json().catch(() => ({}));
        if (!vigente) return;

        if (!res.ok) {
          setErrorResumen(json.error ?? "No se pudo cargar la lista de departamentos.");
          return;
        }
        setResumen(json as RespuestaResumenTerritorio);
      } catch {
        if (vigente) setErrorResumen("No hay conexión con el servidor.");
      } finally {
        if (vigente) setCargandoResumen(false);
      }
    })();

    return () => {
      vigente = false;
    };
  }, [ciclo]);

  // Si el ciclo nuevo no tiene el departamento o la ciudad que estaban
  // elegidos, el filtro vuelve a "sin elegir" en vez de quedar apuntando a
  // algo que ya no aparece en la lista.
  const todosLosDeptos =
    departamento === TODOS_LOS_DEPARTAMENTOS && (resumen?.departamentos.length ?? 0) > 0;
  const deptoElegido: DepartamentoResumen | null =
    (!todosLosDeptos &&
      departamento &&
      resumen?.departamentos.find((d) => d.clave === departamento)) ||
    null;
  const ciudadElegida =
    (deptoElegido && ciudad && deptoElegido.ciudades.find((c) => c.clave === ciudad)) || null;
  const departamentoValido = todosLosDeptos
    ? TODOS_LOS_DEPARTAMENTOS
    : deptoElegido
      ? departamento
      : TODOS;
  const ciudadValida = ciudadElegida ? ciudad : TODOS;
  const totalPuntos = resumen?.departamentos.reduce((n, d) => n + d.puntos, 0) ?? 0;

  // ------------------------------------------------------------ consulta
  function nombres(f: Filtro): { titulo: string; subtitulo: string | null } {
    if (f.departamento === TODOS_LOS_DEPARTAMENTOS) {
      return { titulo: "Todos los departamentos", subtitulo: null };
    }
    const d = resumen?.departamentos.find((x) => x.clave === f.departamento);
    const nombreDepto = d?.nombre ?? "Departamento";
    if (!f.ciudad) return { titulo: nombreDepto, subtitulo: null };
    const c = d?.ciudades.find((x) => x.clave === f.ciudad);
    return { titulo: c?.nombre ?? "Ciudad", subtitulo: nombreDepto };
  }

  async function verPuntos(filtro: Filtro) {
    const id = ++consulta.current;

    setSeleccionado(null);
    setBusqueda("");
    setVisibles(POR_PAGINA);
    setResultado({
      filtro,
      ...nombres(filtro),
      puntos: [],
      total: null,
      cargados: 0,
      cargando: true,
      completo: false,
      aviso: null,
      error: null,
    });

    let acumulado: PuntoTerritorio[] = [];
    let total: number | null = null;
    let desde: number | null = 0;

    // Página tras página. Los puntos se pintan al final y no en cada página:
    // rehacer el mapa veinte veces seguidas solo lo vuelve lento.
    while (desde !== null) {
      const params = new URLSearchParams({
        departamento: filtro.departamento,
        desde: String(desde),
      });
      if (filtro.ciudad) params.set("ciudad", filtro.ciudad);
      if (filtro.ciclo !== TODOS) params.set("ciclo", filtro.ciclo);

      let json: { puntos?: PuntoTerritorio[]; total?: number; siguiente?: number | null; error?: string };
      let ok = false;

      try {
        const res = await fetch(`/api/admin/territorio?${params}`);
        json = await res.json().catch(() => ({}));
        ok = res.ok;
      } catch {
        json = { error: "Se perdió la conexión con el servidor." };
      }

      // El usuario lanzó otra consulta mientras esta seguía: se abandona.
      if (consulta.current !== id) return;

      if (!ok) {
        const leidos = acumulado.length;
        setResultado((r) =>
          r && {
            ...r,
            puntos: acumulado,
            cargados: leidos,
            cargando: false,
            error:
              (json.error ?? "No se pudieron leer los puntos.") +
              (leidos > 0 ? ` Alcanzaron a llegar ${cifra(leidos)} puntos; la descarga queda bloqueada hasta que la consulta termine completa.` : ""),
          }
        );
        return;
      }

      acumulado = acumulado.concat(json.puntos ?? []);
      total = json.total ?? acumulado.length;
      desde = json.siguiente ?? null;

      if (desde !== null && acumulado.length >= TOPE_PUNTOS) {
        setResultado((r) =>
          r && {
            ...r,
            puntos: acumulado,
            total,
            cargados: acumulado.length,
            cargando: false,
            aviso: `Esta selección tiene ${cifra(total ?? 0)} puntos. Se muestran los primeros ${cifra(acumulado.length)}; para verlos todos y descargarlos, acota por ${filtro.departamento === TODOS_LOS_DEPARTAMENTOS ? "departamento, ciudad" : "ciudad"} o ciclo.`,
          }
        );
        return;
      }

      const cargados = acumulado.length;
      const totalVisto = total;
      setResultado((r) => r && { ...r, total: totalVisto, cargados });
    }

    setResultado((r) =>
      r && {
        ...r,
        puntos: acumulado,
        total: acumulado.length,
        cargados: acumulado.length,
        cargando: false,
        completo: true,
      }
    );
  }

  function alEnviar(e: React.FormEvent) {
    e.preventDefault();
    if (!departamentoValido) return;
    verPuntos({ departamento: departamentoValido, ciudad: ciudadValida, ciclo });
  }

  /** Tocar un departamento o una ciudad del desglose acota la consulta a él. */
  function abrirGrupo(clave: string) {
    if (!resultado) return;
    if (agruparPor === "departamento") {
      setDepartamento(clave);
      setCiudad(TODOS);
      verPuntos({ ...resultado.filtro, departamento: clave, ciudad: TODOS });
      return;
    }
    setDepartamento(resultado.filtro.departamento);
    setCiudad(clave);
    verPuntos({ ...resultado.filtro, ciudad: clave });
  }

  function descargar() {
    if (!resultado?.completo) return;
    const partes = resultado.subtitulo
      ? [resultado.subtitulo, resultado.titulo]
      : [resultado.titulo];
    if (resultado.filtro.ciclo !== TODOS) partes.push(etiquetaCiclo(resultado.filtro.ciclo));
    exportarTerritorio(resultado.puntos, partes);
  }

  function elegir(p: PuntoTerritorio) {
    // Un objeto nuevo en cada clic: volver a tocar el mismo punto en la lista
    // también lleva el mapa hasta él.
    setSeleccionado({ id: p.id_registro, desde: "lista" });
    if (p.latitud === null) return;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    mapaRef.current?.scrollIntoView({ behavior: quieto ? "auto" : "smooth", block: "nearest" });
  }

  // ------------------------------------------------------------ derivados
  const puntos = resultado?.puntos;

  // Con todos los departamentos, el desglose y los colores van por
  // departamento; con uno solo, por ciudad.
  const agruparPor: Agrupacion =
    resultado?.filtro.departamento === TODOS_LOS_DEPARTAMENTOS ? "departamento" : "ciudad";

  const grupos = useMemo(() => {
    const mapa = new Map<string, { clave: string; nombre: string; puntos: number }>();
    for (const p of puntos ?? []) {
      const clave = claveGrupo(p, agruparPor);
      const g = mapa.get(clave);
      if (g) g.puntos++;
      else {
        const nombre =
          agruparPor === "departamento"
            ? nombreDepartamento(p.departamento)
            : nombreCiudad(p.ciudad);
        mapa.set(clave, { clave, nombre, puntos: 1 });
      }
    }
    return [...mapa.values()].sort((a, b) => b.puntos - a.puntos);
  }, [puntos, agruparPor]);

  // Un color por grupo, de la misma paleta de las rutas. Si hay más grupos
  // que colores, los más pequeños comparten el gris: repetir colores haría
  // creer que dos lugares distintos son el mismo.
  const colores = useMemo(() => {
    const mapa = new Map<string, string>();
    grupos.forEach((g, i) =>
      mapa.set(g.clave, i < COLORES_RUTA.length ? COLORES_RUTA[i] : COLOR_OTRAS)
    );
    return mapa;
  }, [grupos]);

  const cifras = useMemo(() => {
    const consultores = new Set<string>();
    const departamentos = new Set<string>();
    const ciudades = new Set<string>();
    let sinUbicacion = 0;
    let libres = 0;
    for (const p of puntos ?? []) {
      if (esLibre(p)) libres++;
      else if (p.usuario) consultores.add(p.usuario);
      if (p.latitud === null || p.longitud === null) sinUbicacion++;
      const d = p.departamento_clave ?? SIN_DATO;
      departamentos.add(d);
      // La misma ciudad puede existir en dos departamentos (La Unión, por ejemplo).
      ciudades.add(`${d}${SEP}${p.ciudad_clave ?? SIN_DATO}`);
    }
    return {
      consultores: consultores.size,
      departamentos: departamentos.size,
      ciudades: ciudades.size,
      sinUbicacion,
      libres,
    };
  }, [puntos]);

  // Texto de búsqueda de cada punto, armado una sola vez por consulta.
  const indice = useMemo(
    () =>
      (puntos ?? []).map((p) =>
        sinTildes(
          [p.pdv, p.direccion, p.nom, p.usuario, p.bavaria, p.id_pdv, p.ciudad]
            .filter(Boolean)
            .join(" ")
        )
      ),
    [puntos]
  );

  const filtrados = useMemo(() => {
    const lista = puntos ?? [];
    const q = sinTildes(busqueda.trim());
    if (!q) return lista;
    return lista.filter((_, i) => indice[i].includes(q));
  }, [puntos, indice, busqueda]);

  const varias = grupos.length > 1;

  // ------------------------------------------------------------ pantalla
  return (
    <div className="space-y-4">
      {errorResumen && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-[4px] bg-[var(--color-alerta-fondo)] px-3 py-2.5 text-[13px] text-[var(--color-alerta)]"
        >
          <TriangleAlert size={14} className="shrink-0" aria-hidden />
          {errorResumen}
        </p>
      )}

      {!resumen && cargandoResumen && (
        <p className="flex items-center gap-2 text-[13px] text-[var(--color-tinta-suave)]">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          Cargando departamentos y ciudades…
        </p>
      )}

      {resumen && resumen.departamentos.length === 0 && ciclo === TODOS && (
        <p className="rounded-[4px] border border-dashed border-[var(--color-linea)] px-4 py-6 text-center text-[13px] text-[var(--color-tinta-suave)]">
          Todavía no hay puntos cargados en la cartera.
        </p>
      )}

      {/* ------------------------------------------------------- filtro */}
      {resumen && (resumen.departamentos.length > 0 || ciclo !== TODOS) && (
        <form
          onSubmit={alEnviar}
          className="tarjeta p-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="region-departamento" className="campo-etiqueta">
                Departamento
              </label>
              <select
                id="region-departamento"
                value={departamentoValido}
                onChange={(e) => {
                  setDepartamento(e.target.value);
                  setCiudad(TODOS);
                }}
                className="campo"
              >
                <option value={TODOS}>Elige un departamento</option>
                {resumen.departamentos.length > 0 && (
                  <option value={TODOS_LOS_DEPARTAMENTOS}>
                    Todos los departamentos ({cifra(totalPuntos)} puntos)
                  </option>
                )}
                {resumen.departamentos.map((d) => (
                  <option key={d.clave} value={d.clave}>
                    {d.nombre} ({cifra(d.puntos)} puntos)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="region-ciudad" className="campo-etiqueta">
                Ciudad
              </label>
              <select
                id="region-ciudad"
                value={ciudadValida ? `${departamentoValido}${SEP}${ciudadValida}` : TODOS}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) {
                    setCiudad(TODOS);
                    return;
                  }
                  // Elegir una ciudad deja elegido también su departamento:
                  // así se puede llegar directo a la ciudad sin pasar por él.
                  const corte = v.indexOf(SEP);
                  setDepartamento(v.slice(0, corte));
                  setCiudad(v.slice(corte + 1));
                }}
                className="campo"
              >
                {deptoElegido ? (
                  <>
                    <option value={TODOS}>
                      Todas las ciudades ({cifra(deptoElegido.puntos)} puntos)
                    </option>
                    {deptoElegido.ciudades.map((c) => (
                      <option key={c.clave} value={`${deptoElegido.clave}${SEP}${c.clave}`}>
                        {c.nombre} ({cifra(c.puntos)} puntos)
                      </option>
                    ))}
                  </>
                ) : (
                  <>
                    <option value={TODOS}>
                      {todosLosDeptos
                        ? `Todas las ciudades (${cifra(totalPuntos)} puntos)`
                        : "Elige una ciudad"}
                    </option>
                    {resumen.departamentos.map((d) => (
                      <optgroup key={d.clave} label={d.nombre}>
                        {d.ciudades.map((c) => (
                          <option key={c.clave} value={`${d.clave}${SEP}${c.clave}`}>
                            {c.nombre} ({cifra(c.puntos)} puntos)
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </>
                )}
              </select>
            </div>

            {resumen.ciclos.length > 1 && (
              <div>
                <label htmlFor="region-ciclo" className="campo-etiqueta">
                  Ciclo
                </label>
                <select
                  id="region-ciclo"
                  value={ciclo}
                  onChange={(e) => setCiclo(e.target.value)}
                  className="campo"
                >
                  <option value={TODOS}>Todos los ciclos</option>
                  {resumen.ciclos.map((c) => (
                    <option key={c} value={c === "" ? SIN_DATO : c}>
                      {etiquetaCiclo(c)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {ciclo !== TODOS && resumen.departamentos.length === 0 && !cargandoResumen && (
            <p className="mt-4 text-[13px] text-[var(--color-tinta-suave)]">
              Ese ciclo no tiene puntos. Elige otro ciclo.
            </p>
          )}

          <button
            type="submit"
            disabled={!departamentoValido || cargandoResumen || resultado?.cargando}
            className="boton boton-primario mt-5"
          >
            {resultado?.cargando ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <Search size={15} aria-hidden />
            )}
            Ver puntos
          </button>
        </form>
      )}

      {/* ---------------------------------------------------- resultado */}
      {resultado && (
        <section
          aria-busy={resultado.cargando}
          className="tarjeta p-5"
        >
          <h2 className="text-[15px] font-semibold text-[var(--color-tinta)]">
            {resultado.titulo}
            {resultado.subtitulo && (
              <span className="font-normal text-[var(--color-tinta-suave)]">
                , {resultado.subtitulo}
              </span>
            )}
          </h2>

          {resultado.cargando ? (
            <p className="cifras mt-1 flex items-center gap-2 text-xs text-[var(--color-tinta-suave)]">
              <Loader2 size={13} className="animate-spin" aria-hidden />
              {resultado.total === null
                ? "Buscando los puntos…"
                : `Cargando ${cifra(resultado.cargados)} de ${cifra(resultado.total)} puntos…`}
            </p>
          ) : (
            <p className="cifras mt-1 text-xs text-[var(--color-tinta-suave)]">
              {cifra(resultado.puntos.length)}{" "}
              {resultado.puntos.length === 1 ? "punto" : "puntos"} ·{" "}
              {cifra(cifras.consultores)}{" "}
              {cifras.consultores === 1 ? "consultor" : "consultores"}
              {agruparPor === "departamento" &&
                ` · ${cifra(cifras.departamentos)} ${cifras.departamentos === 1 ? "departamento" : "departamentos"}`}
              {cifras.ciudades > 1 && ` · ${cifra(cifras.ciudades)} ciudades`}
              {resultado.filtro.ciclo !== TODOS
                ? ` · ${etiquetaCiclo(resultado.filtro.ciclo).toLowerCase()}`
                : " · todos los ciclos"}
            </p>
          )}

          {!resultado.cargando && resultado.puntos.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={descargar}
                disabled={!resultado.completo}
                className="boton boton-ambar boton-chico"
              >
                <Sheet size={15} aria-hidden />
                Descargar en Excel
              </button>
              <p className="mt-1.5 text-xs text-[var(--color-tinta-suave)]">
                Trae los {cifra(resultado.puntos.length)} puntos con las{" "}
                {COLUMNAS_EXCEL_TERRITORIO.length} columnas que están en azul en la
                plantilla.
              </p>
            </div>
          )}

          {/* Desglose por departamento o ciudad: también es la leyenda de colores del mapa. */}
          {!resultado.cargando && varias && !resultado.filtro.ciudad && (
            <div className="mt-4 border-t border-[var(--color-linea)] pt-3">
              <p className="text-xs text-[var(--color-tinta-suave)]">
                {agruparPor === "departamento"
                  ? "Toca un departamento para ver solo sus puntos."
                  : "Toca una ciudad para ver solo sus puntos."}
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {grupos.map((c) => (
                  <li key={c.clave}>
                    <button
                      type="button"
                      onClick={() => abrirGrupo(c.clave)}
                      className="flex items-center gap-1.5 rounded-full border border-[var(--color-linea)] px-2.5 py-1 text-xs text-[var(--color-tinta)] hover:border-[var(--color-tinta)]"
                    >
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: colores.get(c.clave) }}
                      />
                      {c.nombre}
                      <span className="cifras text-[var(--color-tinta-suave)]">
                        {cifra(c.puntos)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {resultado?.error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[4px] bg-[var(--color-alerta-fondo)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-alerta)]"
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
          {resultado.error}
        </p>
      )}

      {resultado?.aviso && (
        <p className="flex items-start gap-2 rounded-[4px] bg-[var(--color-aviso-fondo)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-aviso-tinta)]">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
          {resultado.aviso}
        </p>
      )}

      {resultado && !resultado.cargando && (
        <>
          {cifras.libres > 0 && (
            <p className="flex items-center gap-2 rounded-[4px] bg-[var(--color-aviso-fondo)] px-3 py-2.5 text-[13px] text-[var(--color-aviso-tinta)]">
              <TriangleAlert size={14} className="shrink-0" aria-hidden />
              {cifras.libres === 1
                ? "1 punto no tiene consultor asignado (LIBRE)."
                : `${cifra(cifras.libres)} puntos no tienen consultor asignado (LIBRE).`}
            </p>
          )}

          {cifras.sinUbicacion > 0 && (
            <p className="flex items-center gap-2 rounded-[4px] bg-[var(--color-aviso-fondo)] px-3 py-2.5 text-[13px] text-[var(--color-aviso-tinta)]">
              <MapPin size={14} className="shrink-0" aria-hidden />
              {cifras.sinUbicacion === 1
                ? "1 punto no tiene ubicación y no aparece en el mapa. Sí sale en la lista y en el Excel."
                : `${cifra(cifras.sinUbicacion)} puntos no tienen ubicación y no aparecen en el mapa. Sí salen en la lista y en el Excel.`}
            </p>
          )}

          {resultado.puntos.length === 0 && !resultado.error && (
            <p className="rounded-[4px] border border-dashed border-[var(--color-linea)] px-4 py-6 text-center text-[13px] text-[var(--color-tinta-suave)]">
              No hay puntos con ese filtro. Prueba con otro ciclo o con todo el
              departamento.
            </p>
          )}

          {resultado.puntos.length > 0 && (
            <div className="overflow-hidden rounded-[4px] border border-[var(--color-linea)]">
              {/* Sin un solo punto ubicado, el mapa sería un recuadro gris vacío. */}
              {cifras.sinUbicacion < resultado.puntos.length && (
                <div
                  ref={mapaRef}
                  className="h-[46vh] min-h-[280px] border-b border-[var(--color-linea)]"
                >
                  <MapaTerritorioCliente
                    puntos={resultado.puntos}
                    colores={colores}
                    agruparPor={agruparPor}
                    seleccionado={seleccionado}
                    onSeleccionar={(id) => setSeleccionado({ id, desde: "mapa" })}
                  />
                </div>
              )}

              <div className="border-b border-[var(--color-linea)] bg-[var(--color-papel)] p-3">
                <label htmlFor="region-buscar" className="sr-only">
                  Buscar en estos puntos
                </label>
                <input
                  id="region-buscar"
                  value={busqueda}
                  onChange={(e) => {
                    setBusqueda(e.target.value);
                    setVisibles(POR_PAGINA);
                  }}
                  placeholder="Buscar por PDV, dirección, consultor o código"
                  className="campo"
                />
                {busqueda.trim() && (
                  <p className="cifras mt-1.5 text-xs text-[var(--color-tinta-suave)]">
                    {cifra(filtrados.length)} de {cifra(resultado.puntos.length)} puntos
                    coinciden. La búsqueda no cambia lo que trae el Excel.
                  </p>
                )}
              </div>

              <ul className="max-h-[60vh] divide-y divide-[var(--color-linea)] overflow-y-auto bg-[var(--color-papel)]">
                {filtrados.slice(0, visibles).map((p) => {
                  const activo = seleccionado?.id === p.id_registro;
                  return (
                    <li key={p.id_registro}>
                      <button
                        type="button"
                        onClick={() => elegir(p)}
                        aria-current={activo || undefined}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                          activo ? "bg-[var(--color-seleccion)]" : "hover:bg-[var(--color-hover)]"
                        }`}
                      >
                        <span
                          aria-hidden
                          className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            background: colores.get(claveGrupo(p, agruparPor)) ?? COLOR_OTRAS,
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-[var(--color-tinta)]">
                            {p.pdv ?? "Punto sin nombre"}
                          </span>
                          <span className="mt-0.5 block truncate text-[13px] text-[var(--color-tinta-suave)]">
                            {p.direccion ?? "Sin dirección registrada"}
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-tinta-suave)]">
                            {agruparPor === "departamento" ? (
                              <span>
                                {nombreCiudad(p.ciudad)}, {nombreDepartamento(p.departamento)}
                              </span>
                            ) : (
                              cifras.ciudades > 1 && <span>{nombreCiudad(p.ciudad)}</span>
                            )}
                            <span className="text-[var(--color-tinta)]">
                              {esLibre(p) ? "Sin consultor (LIBRE)" : (p.nom ?? p.usuario)}
                              {!esLibre(p) && p.nom && (
                                <span className="cifras text-[var(--color-tinta-suave)]">
                                  {" "}
                                  {p.usuario}
                                </span>
                              )}
                            </span>
                            {p.ciclo && (
                              <span className="cifras rounded-full bg-[var(--color-relleno)] px-2 py-0.5 text-[var(--color-tinta)]">
                                Ciclo {p.ciclo}
                              </span>
                            )}
                            {p.que_hacer && <span>{p.que_hacer}</span>}
                            {p.latitud === null && (
                              <span className="inline-flex items-center gap-1 text-[var(--color-alerta)]">
                                <MapPin size={12} aria-hidden /> sin ubicación
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {filtrados.length === 0 && (
                <p className="bg-[var(--color-papel)] px-4 py-6 text-center text-[13px] text-[var(--color-tinta-suave)]">
                  Ningún punto coincide con esa búsqueda.
                </p>
              )}

              {filtrados.length > visibles && (
                <div className="border-t border-[var(--color-linea)] bg-[var(--color-papel)] p-3 text-center">
                  <button
                    type="button"
                    onClick={() => setVisibles((v) => v + POR_PAGINA)}
                    className="rounded-[4px] border border-[var(--color-linea)] px-3 py-1.5 text-[13px] text-[var(--color-tinta)] hover:border-[var(--color-tinta)]"
                  >
                    Mostrar {cifra(Math.min(POR_PAGINA, filtrados.length - visibles))} más
                    <span className="cifras text-[var(--color-tinta-suave)]">
                      {" "}
                      ({cifra(visibles)} de {cifra(filtrados.length)})
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
