"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImageOff,
  Sheet,
  TriangleAlert,
  X,
} from "lucide-react";
import { limpiarTexto } from "@/lib/limpiadorAuditoria";
import {
  diaCorto,
  exportarImagenes,
  filasDeImagenes,
  ordenarPorFecha,
  type EstadoFoto,
  type FilaImagen,
} from "@/lib/imagenesAuditoria";
import {
  EncabezadoConsulta,
  ProgresoConsulta,
  cifra,
  sinTildes,
  useConsultaAthena,
} from "./ConsultaAthena";

/** Las fotos llegan en su tamaño original, así que se muestran de a pocas. */
const POR_PAGINA = 24;

type Filtro = "todas" | EstadoFoto;

/** Una foto de la galería: la visita a la que pertenece y cuál de sus fotos es. */
type Foto = { fila: FilaImagen; url: string; numero: number; de: number };

const pdvDe = (f: FilaImagen) => limpiarTexto(f.nombre_pdv) ?? "PDV sin nombre";
const usuarioDe = (f: FilaImagen) => limpiarTexto(f.nombre_usuario) ?? "Sin consultor";

/** '12/09/2026 14:05', o lo que traiga la columna si no se entiende como fecha. */
const fechaDe = (f: FilaImagen) =>
  f.dia ? `${diaCorto(f.dia)}${f.hora ? ` ${f.hora}` : ""}` : limpiarTexto(f.fecha_inicio);

export default function AuditoriaImagenes() {
  const {
    fase,
    filas: sinOrdenar,
    info,
    consultar,
    trabajando,
  } = useConsultaAthena<FilaImagen>("/api/admin/auditoria-imagenes", filasDeImagenes);

  /** De la visita más reciente a la más antigua: así salen en la galería y en el Excel. */
  const filas = useMemo(() => ordenarPorFecha(sinOrdenar), [sinOrdenar]);

  /** Rango de fechas, 'AAAA-MM-DD' o vacío. Delimita la galería, los conteos y el Excel. */
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [consultor, setConsultor] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busqueda, setBusqueda] = useState("");
  const [visibles, setVisibles] = useState(POR_PAGINA);
  const [rotas, setRotas] = useState<Set<string>>(() => new Set());
  const [abierta, setAbierta] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /** Nueva consulta: se limpian los filtros de la anterior. */
  function reconsultar(fresca: boolean) {
    setDesde("");
    setHasta("");
    setConsultor("");
    setFiltro("todas");
    setBusqueda("");
    setVisibles(POR_PAGINA);
    setRotas(new Set());
    setAbierta(null);
    setAviso(null);
    consultar(fresca);
  }

  const marcarRota = useCallback((url: string) => {
    setRotas((previas) => (previas.has(url) ? previas : new Set(previas).add(url)));
  }, []);

  // ------------------------------------------------------------ derivados
  /**
   * Primer y último día con visitas, cuántas no traen fecha y, si alguna trae
   * algo que no se entiende como fecha, un ejemplo de cómo llega.
   */
  const fechas = useMemo(() => {
    let primera = "";
    let ultima = "";
    let sinFecha = 0;
    let ilegible = "";
    for (const f of filas) {
      if (!f.dia) {
        sinFecha++;
        if (!ilegible) ilegible = (f.fecha_inicio ?? "").trim();
      } else {
        if (!primera || f.dia < primera) primera = f.dia;
        if (!ultima || f.dia > ultima) ultima = f.dia;
      }
    }
    return { primera, ultima, sinFecha, ilegible };
  }, [filas]);

  const hayRango = desde !== "" || hasta !== "";
  const rangoAlReves = desde !== "" && hasta !== "" && desde > hasta;

  /** Las visitas del rango de fechas. Una visita sin fecha no entra en ningún rango. */
  const enRango = useMemo(() => {
    if (!hayRango) return filas;
    return filas.filter(
      (f) => f.dia !== null && (desde === "" || f.dia >= desde) && (hasta === "" || f.dia <= hasta)
    );
  }, [filas, hayRango, desde, hasta]);

  // Los conteos son de las fechas elegidas; la lista de consultores, de toda la consulta.
  const cuentas = useMemo(() => {
    const porEstado: Record<EstadoFoto, number> = { con_foto: 0, sin_foto: 0, no_es_enlace: 0 };
    const porConsultor = new Map<string, number>();
    for (const f of filas) porConsultor.set(usuarioDe(f), 0);
    for (const f of enRango) {
      porEstado[f.estado]++;
      const u = usuarioDe(f);
      porConsultor.set(u, (porConsultor.get(u) ?? 0) + 1);
    }
    return {
      porEstado,
      consultores: [...porConsultor.entries()].sort((a, b) => a[0].localeCompare(b[0], "es")),
      // Las visitas sin consultor salen en el filtro, pero no cuentan como un consultor más.
      conNombre: new Set(enRango.map((f) => limpiarTexto(f.nombre_usuario)).filter(Boolean)).size,
    };
  }, [filas, enRango]);

  const indice = useMemo(
    () =>
      filas.map((f) =>
        sinTildes([pdvDe(f), f.cod_personalizado, usuarioDe(f)].filter(Boolean).join(" "))
      ),
    [filas]
  );

  const filtradas = useMemo(() => {
    const q = sinTildes(busqueda.trim());
    const delRango = hayRango ? new Set(enRango) : null;
    return filas.filter(
      (f, i) =>
        (!delRango || delRango.has(f)) &&
        (!consultor || usuarioDe(f) === consultor) &&
        (filtro === "todas" || f.estado === filtro) &&
        (!q || indice[i].includes(q))
    );
  }, [filas, enRango, hayRango, indice, consultor, filtro, busqueda]);

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

  function alFiltrar<T>(cambiar: (valor: T) => void) {
    return (valor: T) => {
      cambiar(valor);
      setVisibles(POR_PAGINA);
      setAbierta(null);
    };
  }

  /** El Excel trae las visitas del rango de fechas; sin rango, todas. */
  function descargar() {
    const sufijo =
      desde && hasta
        ? `${desde}_a_${hasta}`
        : desde
          ? `desde_${desde}`
          : hasta
            ? `hasta_${hasta}`
            : new Date().toISOString().slice(0, 10);
    try {
      exportarImagenes(enRango, sufijo);
    } catch {
      setAviso("No se pudo armar el Excel. Intenta de nuevo.");
    }
  }

  /** "entre el 01/09/2026 y el 15/09/2026", "desde el…" o "hasta el…". */
  const textoRango =
    desde && hasta
      ? desde === hasta
        ? `el ${diaCorto(desde)}`
        : `entre el ${diaCorto(desde)} y el ${diaCorto(hasta)}`
      : desde
        ? `desde el ${diaCorto(desde)}`
        : hasta
          ? `hasta el ${diaCorto(hasta)}`
          : "";

  const chips: { id: Filtro; nombre: string; n: number }[] = [
    { id: "todas", nombre: "Todas", n: enRango.length },
    { id: "con_foto", nombre: "Con foto", n: cuentas.porEstado.con_foto },
    { id: "sin_foto", nombre: "Sin foto", n: cuentas.porEstado.sin_foto },
    // Solo aparece si hay valores así: lo normal es que no los haya.
    ...(cuentas.porEstado.no_es_enlace > 0
      ? [{ id: "no_es_enlace" as const, nombre: "Sin enlace válido", n: cuentas.porEstado.no_es_enlace }]
      : []),
  ];

  // ------------------------------------------------------------ pantalla
  return (
    <div className="space-y-4">
      <EncabezadoConsulta
        titulo="Auditoría de imágenes"
        info={info}
        trabajando={trabajando}
        onConsultar={() => reconsultar(true)}
      />

      <ProgresoConsulta fase={fase} onReintentar={() => reconsultar(false)} />

      {aviso && (
        <p className="flex items-center gap-2 rounded-[4px] bg-[#fdf4e3] px-3 py-2.5 text-[13px] text-[#7a5410]">
          <TriangleAlert size={14} className="shrink-0" aria-hidden />
          {aviso}
        </p>
      )}

      {fase.tipo === "listo" && filas.length === 0 && (
        <p className="rounded-[4px] border border-dashed border-[var(--color-linea)] px-4 py-6 text-center text-[13px] text-[var(--color-tinta-suave)]">
          La campaña todavía no tiene visitas iniciadas.
        </p>
      )}

      {fase.tipo === "listo" && filas.length > 0 && (
        <>
          <section className="rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)] p-5">
            <p className="cifras text-[15px] font-semibold text-[var(--color-tinta)]">
              {cifra(enRango.length)} {enRango.length === 1 ? "visita" : "visitas"}
              <span className="font-normal text-[var(--color-tinta-suave)]">
                {" "}
                · {cifra(cuentas.conNombre)} {cuentas.conNombre === 1 ? "consultor" : "consultores"}
                {hayRango && !rangoAlReves && ` · ${textoRango}`}
              </span>
            </p>

            {/* Rango de fechas: delimita la galería, los conteos y el Excel. El
                calendario solo ofrece los días en que hay visitas; un campo no
                limita al otro, para poder mover el rango sin pelear con él. */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="imagenes-desde" className="campo-etiqueta">
                  Desde
                </label>
                <input
                  id="imagenes-desde"
                  type="date"
                  value={desde}
                  min={fechas.primera || undefined}
                  max={fechas.ultima || undefined}
                  onChange={(e) => alFiltrar(setDesde)(e.target.value)}
                  className="campo cifras"
                />
              </div>
              <div>
                <label htmlFor="imagenes-hasta" className="campo-etiqueta">
                  Hasta
                </label>
                <input
                  id="imagenes-hasta"
                  type="date"
                  value={hasta}
                  min={fechas.primera || undefined}
                  max={fechas.ultima || undefined}
                  onChange={(e) => alFiltrar(setHasta)(e.target.value)}
                  className="campo cifras"
                />
              </div>
            </div>

            <p className="cifras mt-1.5 text-xs leading-relaxed text-[var(--color-tinta-suave)]">
              {fechas.primera
                ? fechas.primera === fechas.ultima
                  ? `Todas las visitas son del ${diaCorto(fechas.primera)}.`
                  : `Hay visitas del ${diaCorto(fechas.primera)} al ${diaCorto(fechas.ultima)}.`
                : fechas.ilegible
                  ? `No se pudo leer la fecha de inicio de las visitas (llega como «${fechas.ilegible.slice(0, 40)}»), así que no se pueden filtrar por fecha.`
                  : "Las visitas no traen fecha de inicio."}
              {hayRango && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => {
                      alFiltrar(setDesde)("");
                      setHasta("");
                    }}
                    className="text-[var(--color-tinta)] underline underline-offset-2"
                  >
                    Quitar fechas
                  </button>
                </>
              )}
            </p>

            {rangoAlReves && (
              <p
                role="alert"
                className="mt-2 flex items-center gap-2 rounded-[4px] bg-[#f8ecea] px-3 py-2 text-[13px] text-[var(--color-alerta)]"
              >
                <TriangleAlert size={14} className="shrink-0" aria-hidden />
                «Desde» es posterior a «Hasta»: así ninguna visita entra en el rango.
              </p>
            )}

            {hayRango && fechas.sinFecha > 0 && (
              <p className="cifras mt-2 text-xs text-[var(--color-tinta-suave)]">
                {fechas.sinFecha === 1
                  ? "1 visita no trae fecha y queda fuera de cualquier rango."
                  : `${cifra(fechas.sinFecha)} visitas no traen fecha y quedan fuera de cualquier rango.`}
              </p>
            )}

            <div className="mt-4">
              <button
                type="button"
                onClick={descargar}
                disabled={enRango.length === 0}
                className="flex items-center gap-2 rounded-[4px] bg-[var(--color-ambar)] px-3 py-2 text-[13px] font-medium text-white hover:bg-[var(--color-ambar-oscuro)] disabled:opacity-45 disabled:hover:bg-[var(--color-ambar)]"
              >
                <Sheet size={15} aria-hidden />
                Descargar en Excel
              </button>
              <p className="mt-1.5 text-xs text-[var(--color-tinta-suave)]">
                {!hayRango
                  ? `Trae las ${cifra(filas.length)} visitas con el enlace de cada foto.`
                  : enRango.length === 0
                    ? "No hay visitas en esas fechas para descargar."
                    : `Trae ${enRango.length === 1 ? "la visita" : `las ${cifra(enRango.length)} visitas`} de esas fechas, de ${cifra(filas.length)} en total, con el enlace de cada foto.`}
              </p>
            </div>

            <ul className="mt-4 flex flex-wrap gap-1.5 border-t border-[var(--color-linea)] pt-3">
              {chips.map((c) => {
                const activo = filtro === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-pressed={activo}
                      onClick={() => alFiltrar(setFiltro)(c.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                        activo
                          ? "border-[var(--color-tinta)] bg-[var(--color-tinta)] text-white"
                          : "border-[var(--color-linea)] text-[var(--color-tinta)] hover:border-[var(--color-tinta)]"
                      }`}
                    >
                      {c.nombre}
                      <span
                        className={`cifras ${activo ? "text-white/75" : "text-[var(--color-tinta-suave)]"}`}
                      >
                        {cifra(c.n)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="imagenes-consultor" className="campo-etiqueta">
                Consultor
              </label>
              <select
                id="imagenes-consultor"
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
              <label htmlFor="imagenes-buscar" className="campo-etiqueta">
                Buscar
              </label>
              <input
                id="imagenes-buscar"
                value={busqueda}
                onChange={(e) => alFiltrar(setBusqueda)(e.target.value)}
                placeholder="PDV o código"
                className="campo"
              />
            </div>
          </section>

          {(consultor || busqueda.trim() || filtro !== "todas") && (
            <p className="cifras text-xs text-[var(--color-tinta-suave)]">
              {cifra(filtradas.length)} de {cifra(enRango.length)} visitas
              {hayRango ? " de esas fechas" : ""}. Al Excel solo lo delimitan las fechas, no
              estos filtros.
            </p>
          )}

          {rotas.size > 0 && (
            <p className="flex items-start gap-2 rounded-[4px] bg-[#fdf4e3] px-3 py-2.5 text-[13px] leading-snug text-[#7a5410]">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
              {rotas.size === 1
                ? "1 foto no cargó."
                : `${cifra(rotas.size)} fotos no cargaron.`}{" "}
              Puede que el enlace ya no exista o que el servidor de fotos no deje verlas desde
              esta página.
            </p>
          )}

          {filtradas.length === 0 ? (
            <p className="rounded-[4px] border border-dashed border-[var(--color-linea)] px-4 py-6 text-center text-[13px] text-[var(--color-tinta-suave)]">
              {enRango.length === 0
                ? "No hay visitas en esas fechas."
                : "Ninguna visita coincide con ese filtro."}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {filtradas.slice(0, visibles).map((f) => (
                <li
                  key={numero.get(f)}
                  className="overflow-hidden rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)]"
                >
                  <Miniatura
                    fila={f}
                    rota={f.fotos.length > 0 && rotas.has(f.fotos[0])}
                    onRota={marcarRota}
                    onAbrir={() => setAbierta(fotos.primera.get(f) ?? null)}
                  />
                  <div className="px-3 py-2.5">
                    <p className="line-clamp-2 text-[13px] leading-snug font-medium text-[var(--color-tinta)]">
                      {pdvDe(f)}
                    </p>
                    <p className="cifras mt-1 truncate text-xs text-[var(--color-tinta-suave)]">
                      {[f.cod_personalizado, usuarioDe(f)].filter(Boolean).join(" · ")}
                    </p>
                    <p className="cifras mt-0.5 truncate text-xs text-[var(--color-tinta-suave)]">
                      {fechaDe(f) ?? "Sin fecha"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {filtradas.length > visibles && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setVisibles((v) => v + POR_PAGINA)}
                className="rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)] px-3 py-1.5 text-[13px] text-[var(--color-tinta)] hover:border-[var(--color-tinta)]"
              >
                Mostrar {cifra(Math.min(POR_PAGINA, filtradas.length - visibles))} más
                <span className="cifras text-[var(--color-tinta-suave)]">
                  {" "}
                  ({cifra(visibles)} de {cifra(filtradas.length)})
                </span>
              </button>
            </div>
          )}
        </>
      )}

      {abierta !== null && fotos.lista[abierta] && (
        <Visor
          foto={fotos.lista[abierta]}
          posicion={abierta}
          total={fotos.lista.length}
          rota={rotas.has(fotos.lista[abierta].url)}
          onRota={marcarRota}
          onIr={setAbierta}
          onCerrar={() => setAbierta(null)}
        />
      )}
    </div>
  );
}

/** La foto de la visita en la galería, o por qué no hay foto que mostrar. */
function Miniatura({
  fila,
  rota,
  onRota,
  onAbrir,
}: {
  fila: FilaImagen;
  rota: boolean;
  onRota: (url: string) => void;
  onAbrir: () => void;
}) {
  const centrado = "flex flex-col items-center justify-center gap-1.5 bg-[#e8eae6] px-3 text-center text-xs";
  const marco = `aspect-[4/3] w-full ${centrado}`;

  if (fila.estado === "sin_foto") {
    return (
      <div className={`${marco} text-[var(--color-alerta)]`}>
        <ImageOff size={20} aria-hidden />
        Sin foto
      </div>
    );
  }

  if (fila.estado === "no_es_enlace") {
    return (
      <div className={`${marco} text-[var(--color-tinta-suave)]`}>
        <ImageOff size={20} aria-hidden />
        <span>El valor no es un enlace</span>
        <span className="line-clamp-2 w-full break-all text-[11px]">{fila.foto_visita_inicio}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-label={`Ver en grande la foto de ${pdvDe(fila)}`}
      className="relative block aspect-[4/3] w-full bg-[#e8eae6]"
    >
      {rota ? (
        <span className={`h-full w-full ${centrado} text-[var(--color-tinta-suave)]`}>
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
      {fila.fotos.length > 1 && (
        <span className="cifras absolute right-1.5 bottom-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">
          {fila.fotos.length} fotos
        </span>
      )}
    </button>
  );
}

/** La foto en grande, con sus datos y flechas para pasar a la anterior o la siguiente. */
function Visor({
  foto,
  posicion,
  total,
  rota,
  onRota,
  onIr,
  onCerrar,
}: {
  foto: Foto;
  posicion: number;
  total: number;
  rota: boolean;
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
              alt={`Foto de inicio de visita en ${pdvDe(foto.fila)}`}
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

      <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-white/70">
        <span className="cifras">
          {cifra(posicion + 1)} de {cifra(total)}
        </span>
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
