"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  ClipboardCheck,
  FileSpreadsheet,
  Loader2,
  MapPin,
  Search,
  TriangleAlert,
  Upload,
  UserX,
  Users,
  Wrench,
} from "lucide-react";
import { filasDesdeAthena, type FilaAuditoria } from "@/lib/auditoria";
import { cuando } from "@/lib/fechas";
import { exportarTerritorio } from "@/lib/excel";
import {
  guardarResumenAuditoria,
  leerResumenAuditoria,
  resumirAuditoria,
  type ResumenAuditoria,
} from "@/lib/resumenAuditoria";
import type { PuntoTerritorio } from "@/lib/territorio";
import EncabezadoPagina from "./EncabezadoPagina";
import { ProgresoConsulta, cifra, useConsultaAthena } from "./ConsultaAthena";

/**
 * Inicio del administrador: cómo está la cartera hoy, atajos, un resumen de
 * la auditoría, lo último que se hizo en el panel y lo que conviene revisar.
 */

type Carga = {
  archivo: string;
  modo: string | null;
  filas: number;
  filas_ok: number;
  filas_error: number;
  detalle: { fila: number; motivo: string }[];
  cargado_por: string | null;
  created_at: string;
};

type Resumen = {
  ciclo: string | null;
  ciclos: { ciclo: string; puntos: number; consultores: number; sin_ubicacion: number }[];
  mantenimiento: { activo: boolean; hasta: string | null };
  errorCiclos: string | null;
  actual: { ciclo: string; puntos: number; consultores: number; sin_ubicacion: number } | null;
  /** Toda la cartera, todos los ciclos. null: no se pudo contar. */
  general: {
    puntos: number;
    sin_ubicacion: number;
    asignados: number | null;
    libres: number | null;
    consultores: number | null;
  };
  libres: number | null;
  ultimaCarga: Carga | null;
  departamentos: { nombre: string; puntos: number }[] | null;
};

type ItemActividad = {
  momento: string;
  usuario: string | null;
  accion: string;
  detalle: Record<string, unknown> | null;
};

/** Cómo se llama cada campo editable cuando se cuenta qué cambió. */
const CAMPO: Record<string, string> = {
  pdv: "nombre",
  direccion: "dirección",
  persona_hacku: "contacto",
  celular: "celular",
  que_hacer: "tarea",
  ruta: "ruta",
  num_de_ruta: "ruta del consultor",
  usuario: "usuario",
  ccuser: "cédula",
  nom: "nombre del consultor",
  persona: "persona",
  latitud: "coordenadas",
  longitud: "coordenadas",
};

const PERFIL: Record<string, string> = {
  superadmin: "superadministrador",
  admin: "administrador",
  backoffice: "BackOffice",
};

/** Lo que pasó, en una frase, y un detalle debajo. */
function describir(a: ItemActividad): { frase: string; detalle: string | null } {
  const d = a.detalle ?? {};
  const txt = (k: string) => (d[k] === undefined || d[k] === null ? "" : String(d[k]));
  switch (a.accion) {
    case "cargar":
      return {
        frase:
          d.modo === "actualizar"
            ? "actualizó la cartera con un archivo"
            : d.modo === "agregar"
              ? "agregó puntos nuevos"
              : "cargó la plantilla completa",
        detalle: `${txt("archivo")} · ${cifra(Number(d.filas) || 0)} filas`,
      };
    case "editar": {
      const campos = [
        ...new Set(
          Object.keys(d)
            .filter((k) => k !== "id_pdv" && k !== "ciclo")
            .map((k) => CAMPO[k] ?? k.replace(/_/g, " "))
        ),
      ];
      return {
        frase: `editó el punto ${txt("id_pdv")}`,
        detalle: campos.length ? `Cambió ${campos.slice(0, 4).join(", ")}` : null,
      };
    }
    case "eliminar":
      return { frase: `eliminó el punto ${txt("id_pdv")}`, detalle: txt("pdv") || null };
    case "purgar":
      return {
        frase: `eliminó ${txt("alcance") || "puntos de la cartera"}`,
        detalle: `${cifra(Number(d.eliminados) || 0)} puntos`,
      };
    case "mantenimiento_abrir":
      return { frase: "puso la consulta en mantenimiento", detalle: txt("mensaje") || null };
    case "mantenimiento_cerrar":
      return { frase: "abrió de nuevo la consulta", detalle: null };
    case "usuario_crear":
      return {
        frase: `creó el usuario ${txt("usuario")}`,
        detalle: `Perfil ${PERFIL[txt("rol")] ?? txt("rol")}`,
      };
    case "usuario_clave":
      return { frase: `cambió la clave de ${txt("usuario")}`, detalle: null };
    case "usuario_rol":
      return {
        frase: `cambió el perfil de ${txt("usuario")}`,
        detalle: `De ${PERFIL[txt("antes")] ?? txt("antes")} a ${PERFIL[txt("ahora")] ?? txt("ahora")}`,
      };
    case "usuario_activar":
      return { frase: `reactivó a ${txt("usuario")}`, detalle: null };
    case "usuario_desactivar":
      return { frase: `desactivó a ${txt("usuario")}`, detalle: null };
    case "tablero_agregar":
      return { frase: `agregó el tablero «${txt("nombre")}»`, detalle: null };
    case "tablero_editar":
      return { frase: `editó el tablero «${txt("nombre")}»`, detalle: null };
    case "tablero_publicar":
      return { frase: `publicó el tablero «${txt("nombre")}»`, detalle: null };
    case "tablero_ocultar":
      return { frase: `ocultó el tablero «${txt("nombre")}»`, detalle: null };
    case "tablero_eliminar":
      return { frase: `eliminó el tablero «${txt("nombre")}»`, detalle: null };
    case "tema_cambiar":
      return { frase: "cambió los temas de temporada", detalle: txt("descripcion") || null };
    default:
      return { frase: a.accion.replace(/_/g, " "), detalle: null };
  }
}

/** "Viernes, 9 de octubre". */
function hoyEnPalabras(): string {
  const t = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Bogota",
  }).format(new Date());
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function Inicio({ irA }: { irA: (seccion: string) => void }) {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [errorResumen, setErrorResumen] = useState<string | null>(null);
  const [actividad, setActividad] = useState<ItemActividad[] | null>(null);
  const [avisoActividad, setAvisoActividad] = useState<string | null>(null);
  const [auditoria, setAuditoria] = useState<ResumenAuditoria | null>(null);
  const [verObservaciones, setVerObservaciones] = useState(false);
  const [bajando, setBajando] = useState<string | null>(null);
  const [hoy, setHoy] = useState("");

  // La auditoría no corre sola aquí: consultar Athena en cada visita al Inicio
  // sería lento y costaría. Se muestra lo último que se vio y se puede pedir.
  const consulta = useConsultaAthena<FilaAuditoria>("/api/admin/auditoria", filasDesdeAthena, {
    automatica: false,
  });

  useEffect(() => {
    setHoy(hoyEnPalabras());
    setAuditoria(leerResumenAuditoria());

    fetch("/api/admin/resumen")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? "No se pudo leer el resumen.");
        setResumen(j as Resumen);
      })
      .catch((e) => setErrorResumen((e as Error).message));

    fetch("/api/admin/actividad?limite=7")
      .then((r) => (r.ok ? r.json() : { actividad: [] }))
      .then((j) => {
        setActividad(j.actividad ?? []);
        setAvisoActividad(j.aviso ?? null);
      })
      .catch(() => setActividad([]));
  }, []);

  useEffect(() => {
    if (consulta.fase.tipo !== "listo") return;
    const r = resumirAuditoria(consulta.filas, consulta.info?.enviada ?? null);
    guardarResumenAuditoria(r);
    setAuditoria(r);
  }, [consulta.fase.tipo, consulta.filas, consulta.info]);

  async function descargarLista(tipo: "sin-ubicacion" | "libres") {
    setBajando(tipo);
    try {
      const r = await fetch(`/api/admin/resumen?lista=${tipo}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      exportarTerritorio(j.puntos as PuntoTerritorio[], [
        tipo === "libres" ? "sin_consultor" : "sin_coordenadas",
        "toda_la_cartera",
      ]);
    } catch {
      setErrorResumen("No se pudo armar el Excel. Intenta de nuevo.");
    } finally {
      setBajando(null);
    }
  }

  const general = resumen?.general ?? null;
  const ultima = resumen?.ultimaCarga ?? null;
  const deptos = resumen?.departamentos ?? null;
  const maxDepto = deptos?.[0]?.puntos ?? 1;

  const pendientes: {
    id: string;
    tono: "alerta" | "aviso" | "neutro";
    Icono: typeof MapPin;
    titulo: string;
    detalle: string;
    accion: React.ReactNode;
  }[] = [];

  if (resumen?.mantenimiento.activo) {
    pendientes.push({
      id: "mantenimiento",
      tono: "aviso",
      Icono: Wrench,
      titulo: "La consulta está en mantenimiento",
      detalle: "Los consultores ven el aviso y no pueden consultar su cartera.",
      accion: (
        <a href="#mantenimiento" className="text-[13px] font-medium whitespace-nowrap underline underline-offset-2">
          Revisar
        </a>
      ),
    });
  }
  if (general && general.sin_ubicacion > 0) {
    pendientes.push({
      id: "sin-ubicacion",
      tono: "alerta",
      Icono: MapPin,
      titulo: `${cifra(general.sin_ubicacion)} ${general.sin_ubicacion === 1 ? "punto" : "puntos"} sin coordenadas`,
      detalle: "No aparecen en el mapa del consultor.",
      accion: (
        <button
          type="button"
          onClick={() => descargarLista("sin-ubicacion")}
          disabled={bajando !== null}
          className="text-[13px] font-medium whitespace-nowrap underline underline-offset-2 disabled:opacity-50"
        >
          {bajando === "sin-ubicacion" ? "Armando…" : "Descargar"}
        </button>
      ),
    });
  }
  if (ultima && ultima.filas_error > 0) {
    pendientes.push({
      id: "observaciones",
      tono: "aviso",
      Icono: FileSpreadsheet,
      titulo: `${cifra(ultima.filas_error)} ${ultima.filas_error === 1 ? "fila" : "filas"} con observaciones en el último cargue`,
      detalle: ultima.archivo,
      accion: ultima.detalle.length > 0 && (
        <button
          type="button"
          aria-expanded={verObservaciones}
          onClick={() => setVerObservaciones((v) => !v)}
          className="text-[13px] font-medium whitespace-nowrap underline underline-offset-2"
        >
          {verObservaciones ? "Ocultar" : "Ver"}
        </button>
      ),
    });
  }
  if (general?.libres) {
    pendientes.push({
      id: "libres",
      tono: "neutro",
      Icono: UserX,
      titulo: `${cifra(general.libres)} ${general.libres === 1 ? "punto" : "puntos"} sin consultor (LIBRE)`,
      detalle: "En toda la cartera.",
      accion: (
        <button
          type="button"
          onClick={() => descargarLista("libres")}
          disabled={bajando !== null}
          className="text-[13px] font-medium whitespace-nowrap underline underline-offset-2 disabled:opacity-50"
        >
          {bajando === "libres" ? "Armando…" : "Descargar"}
        </button>
      ),
    });
  }

  const TONO = {
    alerta: "bg-[var(--color-alerta-fondo)] text-[var(--color-alerta)]",
    aviso: "bg-[var(--color-aviso-fondo)] text-[var(--color-aviso-tinta)]",
    neutro: "bg-[var(--color-relleno)] text-[var(--color-tinta)]",
  };

  return (
    <div className="space-y-7">
      <EncabezadoPagina
        titulo="Inicio"
        descripcion={hoy ? `${hoy} · así está la cartera hoy` : " "}
        acciones={
          <button type="button" onClick={() => irA("cargar")} className="boton boton-primario">
            <Upload size={16} aria-hidden />
            Cargar plantilla
          </button>
        }
      />

      {errorResumen && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-[4px] bg-[var(--color-alerta-fondo)] px-3 py-2.5 text-[13px] text-[var(--color-alerta)]"
        >
          <TriangleAlert size={14} className="shrink-0" aria-hidden />
          {errorResumen}
        </p>
      )}

      {/* ------------------------------------------------------------ cifras */}
      <section aria-label="Resumen de la cartera" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            // Conteo general: toda la cartera, todos los ciclos.
            titulo: "Puntos asignados",
            valor: general ? cifra(general.asignados ?? general.puntos) : null,
            nota: !general || general.puntos === 0
              ? "Todavía no hay cartera cargada"
              : general.libres === null
                ? "Toda la cartera"
                : general.libres > 0
                  ? `De ${cifra(general.puntos)} en total · ${cifra(general.libres)} sin consultor`
                  : "Toda la cartera, todos los ciclos",
          },
          {
            titulo: "Consultores con puntos",
            valor: general ? (general.consultores === null ? "—" : cifra(general.consultores)) : null,
            nota:
              general?.consultores === null
                ? "Falta la vista resumen_consultores (supabase/gestion.sql)"
                : "Con al menos un punto asignado",
          },
          {
            titulo: "Puntos sin coordenadas",
            valor: general ? cifra(general.sin_ubicacion) : null,
            nota: "No salen en el mapa del consultor",
            alerta: (general?.sin_ubicacion ?? 0) > 0,
          },
          {
            titulo: "Último cargue",
            valor: ultima ? cuando(ultima.created_at) : resumen ? "Sin cargas" : null,
            nota: ultima ? `${ultima.archivo}${ultima.cargado_por ? ` · ${ultima.cargado_por}` : ""}` : "",
            chico: true,
          },
        ].map((c) => (
          <div key={c.titulo} className="tarjeta px-5 py-4">
            <p className="text-[13px] text-[var(--color-tinta-suave)]">{c.titulo}</p>
            {c.valor === null ? (
              <p className="mt-3 h-8 w-24 animate-pulse rounded bg-[var(--color-relleno)]" />
            ) : (
              <p
                className={`cifras mt-1.5 font-semibold first-letter:uppercase ${
                  c.chico ? "text-[20px] leading-snug" : "text-[30px] leading-tight"
                } ${c.alerta ? "text-[var(--color-alerta)]" : ""}`}
              >
                {c.valor}
              </p>
            )}
            <p className="mt-1 line-clamp-2 text-[13px] break-words text-[var(--color-tinta-suave)]" title={c.nota}>
              {c.nota}
            </p>
          </div>
        ))}
      </section>

      {/* ------------------------------------------------------------ atajos */}
      <section aria-labelledby="atajos" className="space-y-3">
        <h2 id="atajos" className="text-[15px] font-semibold">
          Atajos
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { id: "editar", Icono: Search, titulo: "Buscar un punto", detalle: "Por código, PDV o dirección" },
            { id: "consultores", Icono: Users, titulo: "Cartera de un consultor", detalle: "Mapa, puntos y descargas" },
            { id: "territorio", Icono: MapPin, titulo: "Puntos por departamento", detalle: "Filtrar y bajar en Excel" },
            { id: "auditoria", Icono: ClipboardCheck, titulo: "Auditoría de datos", detalle: "Hallazgos y Excel limpio" },
          ].map((a) => (
            <a
              key={a.id}
              href={`#${a.id}`}
              className="tarjeta flex min-h-[64px] items-center gap-3 px-4 py-3 hover:border-[var(--color-tinta)]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[var(--color-relleno)]">
                <a.Icono size={18} strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium">{a.titulo}</span>
                <span className="block text-xs text-[var(--color-tinta-suave)]">{a.detalle}</span>
              </span>
            </a>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* ---------------------------------------------------------- auditoría */}
        <section aria-labelledby="resumen-auditoria" className="tarjeta px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="resumen-auditoria" className="text-[15px] font-semibold">
              Auditoría de datos
            </h2>
            {auditoria && (
              <span className="text-xs text-[var(--color-tinta-suave)]">
                Consultada {cuando(auditoria.momento)}
              </span>
            )}
          </div>

          {consulta.trabajando || consulta.fase.tipo === "error" ? (
            <div className="mt-4">
              <ProgresoConsulta fase={consulta.fase} onReintentar={() => consulta.consultar(false)} />
            </div>
          ) : auditoria ? (
            <>
              <p className="cifras mt-1.5 text-[22px] font-semibold">
                {cifra(auditoria.total)} hallazgos{" "}
                <span className="text-[14px] font-normal text-[var(--color-tinta-suave)]">
                  · {cifra(auditoria.consultores)} consultores
                </span>
              </p>
              <ul className="mt-4 space-y-3">
                {auditoria.motivos.slice(0, 5).map((m) => (
                  <li key={m.nombre}>
                    <div className="flex justify-between gap-3 text-[13px]">
                      <span>{m.nombre}</span>
                      <span className="cifras text-[var(--color-tinta-suave)]">{cifra(m.n)}</span>
                    </div>
                    <div className="mt-1.5 h-2 rounded bg-[var(--color-relleno)]">
                      <div
                        className="h-2 rounded bg-[var(--color-tinta-suave)]"
                        style={{ width: `${Math.max(2, (m.n / (auditoria.motivos[0]?.n || 1)) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
              Todavía no has consultado la auditoría desde este navegador. Al consultarla, aquí
              queda cuántos hallazgos hay y de qué tipo.
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <a href="#auditoria" className="inline-flex items-center gap-1.5 text-[14px] font-medium">
              Abrir la auditoría
              <ArrowRight size={15} aria-hidden />
            </a>
            <button
              type="button"
              onClick={() => consulta.consultar(true)}
              disabled={consulta.trabajando}
              className="text-[13px] text-[var(--color-tinta-suave)] underline underline-offset-2 hover:text-[var(--color-tinta)] disabled:opacity-50"
            >
              {auditoria ? "Actualizar el resumen" : "Consultar ahora"}
            </button>
          </div>
        </section>

        {/* ---------------------------------------------------------- actividad */}
        <section aria-labelledby="actividad" className="tarjeta px-5 py-5 sm:px-6">
          <h2 id="actividad" className="text-[15px] font-semibold">
            Actividad reciente
          </h2>
          {actividad === null ? (
            <p className="mt-4 flex items-center gap-2 text-[13px] text-[var(--color-tinta-suave)]">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Cargando…
            </p>
          ) : actividad.length === 0 ? (
            <p className="mt-3 text-[13px] text-[var(--color-tinta-suave)]">
              Todavía no hay movimientos registrados.
            </p>
          ) : (
            <ol className="mt-3">
              {actividad.map((a, i) => {
                const { frase, detalle } = describir(a);
                return (
                  <li
                    key={`${a.momento}-${i}`}
                    className="flex gap-3 border-b border-[var(--color-linea)] py-2.5 last:border-b-0"
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        a.accion === "cargar"
                          ? "bg-[var(--color-tinta)]"
                          : a.accion.startsWith("mantenimiento") || a.accion === "purgar"
                            ? "bg-[var(--color-ambar)]"
                            : "bg-[var(--color-marcador)]"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] leading-snug">
                        <b className="font-semibold">{a.usuario ?? "Alguien"}</b> {frase}
                      </p>
                      <p className="cifras mt-0.5 truncate text-xs text-[var(--color-tinta-suave)]">
                        {[detalle, cuando(a.momento)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {avisoActividad && (
            <p className="mt-3 text-xs leading-relaxed text-[var(--color-tinta-suave)]">{avisoActividad}</p>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* ---------------------------------------------------------- departamentos */}
        <section aria-labelledby="departamentos" className="tarjeta px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="departamentos" className="text-[15px] font-semibold">
              Puntos por departamento
              {general && general.puntos > 0 && (
                <span className="cifras font-normal text-[var(--color-tinta-suave)]">
                  {" "}
                  · {cifra(general.puntos)} en total
                </span>
              )}
            </h2>
            {deptos && deptos.length > 0 && (
              <a href="#territorio" className="text-[13px] underline underline-offset-2">
                Ver {deptos.length === 1 ? "el departamento" : `los ${deptos.length} departamentos`}
              </a>
            )}
          </div>
          {deptos === null ? (
            <p className="mt-3 text-[13px] text-[var(--color-tinta-suave)]">
              {resumen
                ? "Para ver este resumen, ejecuta supabase/territorio.sql en el SQL Editor."
                : "Cargando…"}
            </p>
          ) : deptos.length === 0 ? (
            <p className="mt-3 text-[13px] text-[var(--color-tinta-suave)]">No hay puntos cargados.</p>
          ) : (
            <div className="cifras mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-x-4 gap-y-2.5 text-[13px]">
              {deptos.slice(0, 6).map((d) => (
                <div key={d.nombre} className="contents">
                  <span className="truncate" title={d.nombre}>
                    {d.nombre}
                  </span>
                  <span className="h-2.5 rounded bg-[var(--color-relleno)]">
                    <span
                      className="block h-2.5 rounded bg-[var(--color-barra)]"
                      style={{ width: `${Math.max(2, (d.puntos / maxDepto) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right">{cifra(d.puntos)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------- para revisar */}
        <section aria-labelledby="revisar" className="tarjeta px-5 py-5 sm:px-6">
          <h2 id="revisar" className="text-[15px] font-semibold">
            Para revisar
          </h2>
          {!resumen ? (
            <p className="mt-3 text-[13px] text-[var(--color-tinta-suave)]">Cargando…</p>
          ) : pendientes.length === 0 ? (
            <p className="mt-3 text-[13px] text-[var(--color-tinta-suave)]">
              Todo en orden: no hay nada pendiente.
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {pendientes.map((p) => (
                <li key={p.id}>
                  <div className={`flex items-start gap-3 rounded-[6px] px-3 py-3 ${TONO[p.tono]}`}>
                    <p.Icono size={17} className="mt-0.5 shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold">{p.titulo}</p>
                      <p className="mt-0.5 truncate text-xs opacity-90" title={p.detalle}>
                        {p.detalle}
                      </p>
                    </div>
                    {p.accion}
                  </div>
                  {p.id === "observaciones" && verObservaciones && ultima && (
                    <ul className="cifras mt-2 max-h-48 space-y-1 overflow-y-auto px-1 text-xs text-[var(--color-tinta-suave)]">
                      {ultima.detalle.map((o, i) => (
                        <li key={i}>
                          Fila {cifra(o.fila)}: {o.motivo}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
