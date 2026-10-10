"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { ACEPTA, pesoLegible, preparar, type TipoAdjunto } from "@/lib/archivosAsistente";

/**
 * Asistente IA: chat con Gemini y DeepSeek. Pregunta lo que sea y adjunta
 * imágenes, PDF, Word, Excel, PowerPoint o texto.
 *
 * La conversación vive en esta pestaña del navegador (se conserva al cambiar
 * de sección o recargar, y se borra con «Nueva conversación»). No se guarda en
 * la base.
 */

type Modo = "combinado" | "gemini" | "deepseek";
type IA = "gemini" | "deepseek";

type Adjunto = {
  id: string;
  tipo: TipoAdjunto;
  nombre: string;
  estado: "preparando" | "listo" | "error";
  error?: string;
  /** Imagen o PDF ya en Gemini. */
  uri?: string;
  mime?: string;
  /** Imagen reducida en base64, para DeepSeek; solo hasta enviarse. */
  base64?: string;
  miniatura?: string;
  /** Texto sacado del documento. */
  contenido?: string;
  peso?: number;
};

/** Como viaja un adjunto al servidor. */
type AdjuntoEnvio =
  | { tipo: "texto"; nombre: string; contenido: string }
  | { tipo: "archivo"; nombre: string; mime: string; uri: string };

type Mensaje = {
  id: string;
  rol: "usuario" | "asistente";
  texto: string;
  adjuntos: Adjunto[];
  /** Solo respuestas: */
  estado?: "trabajando" | "listo" | "error" | "detenido";
  avance?: string;
  borradores?: Partial<Record<IA, { texto?: string; error?: string }>>;
  fuentes?: IA[];
  aviso?: string;
  error?: string;
};

const MODOS: { id: Modo; nombre: string; detalle: string }[] = [
  { id: "combinado", nombre: "Gemini + DeepSeek", detalle: "Las dos responden y se combina lo mejor" },
  { id: "gemini", nombre: "Solo Gemini", detalle: "Más rápido; ve imágenes y PDF" },
  { id: "deepseek", nombre: "Solo DeepSeek", detalle: "Más rápido; ve imágenes, no PDF" },
];

const NOMBRE_IA: Record<IA, string> = { gemini: "Gemini", deepseek: "DeepSeek" };

const SUGERENCIAS = [
  "Resume este documento en cinco puntos",
  "¿Qué ves en esta imagen?",
  "Escribe una fórmula de Excel que busque un código en otra hoja",
  "Redacta un mensaje para un consultor que no ha cargado sus visitas",
];

const MAX_ADJUNTOS = 6;
const LLAVE = "cartera.asistente";

/** Lo que sobrevive a cambiar de sección sin recargar. */
let memoria: { mensajes: Mensaje[]; modo: Modo } | null = null;

function leerGuardado(): { mensajes: Mensaje[]; modo: Modo } {
  if (memoria) return memoria;
  try {
    const crudo = sessionStorage.getItem(LLAVE);
    if (crudo) {
      const g = JSON.parse(crudo) as { mensajes: Mensaje[]; modo: Modo };
      // Una respuesta que quedó a medias al recargar ya no va a terminar.
      g.mensajes = g.mensajes.map((m) => (m.estado === "trabajando" ? { ...m, estado: "detenido" } : m));
      return g;
    }
  } catch {
    // sin almacenamiento: se empieza de cero
  }
  return { mensajes: [], modo: "combinado" };
}

function guardar(mensajes: Mensaje[], modo: Modo) {
  memoria = { mensajes, modo };
  try {
    // Sin las imágenes en base64: pesan mucho y ya se enviaron.
    const livianos = mensajes.map((m) => ({ ...m, adjuntos: m.adjuntos.map((a) => ({ ...a, base64: undefined })) }));
    sessionStorage.setItem(LLAVE, JSON.stringify({ mensajes: livianos, modo }));
  } catch {
    // lleno o bloqueado: queda solo en memoria
  }
}

const nuevoId = () => Math.random().toString(36).slice(2, 10);

// ------------------------------------------------------------------ piezas

function Markdown({ texto }: { texto: string }) {
  return (
    <div className="md-ia">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="md-ia-tabla">
              <table>{children}</table>
            </div>
          ),
          // Sin imágenes remotas en las respuestas: no se cargan direcciones que escribió una IA.
          img: ({ alt }) => <span>{alt ? `[imagen: ${alt}]` : ""}</span>,
        }}
      >
        {texto}
      </ReactMarkdown>
    </div>
  );
}

function ChipAdjunto({ a, onQuitar }: { a: Adjunto; onQuitar?: () => void }) {
  const Icono = a.tipo === "imagen" ? ImageIcon : FileText;
  return (
    <span
      className={`inline-flex max-w-[240px] items-center gap-2 rounded-[6px] border px-2 py-1.5 text-xs ${
        a.estado === "error"
          ? "border-[var(--color-alerta)] bg-[var(--color-alerta-fondo)] text-[var(--color-alerta)]"
          : "border-[var(--color-linea)] bg-[var(--color-papel)]"
      }`}
      title={a.error ?? a.nombre}
    >
      {a.miniatura ? (
        // eslint-disable-next-line @next/next/no-img-element -- miniatura local en base64
        <img src={a.miniatura} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
      ) : (
        <Icono size={16} className="shrink-0 text-[var(--color-tinta-suave)]" aria-hidden />
      )}
      <span className="min-w-0">
        <span className="block truncate font-medium">{a.nombre}</span>
        <span className="block truncate text-[11px] text-[var(--color-tinta-suave)]">
          {a.estado === "preparando"
            ? "Preparando…"
            : a.estado === "error"
              ? a.error
              : a.tipo === "texto"
                ? `${(a.contenido?.length ?? 0).toLocaleString("es-CO")} caracteres`
                : a.peso
                  ? pesoLegible(a.peso)
                  : a.tipo === "pdf"
                    ? "PDF"
                    : "Imagen"}
        </span>
      </span>
      {a.estado === "preparando" && <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden />}
      {onQuitar && (
        <button
          type="button"
          onClick={onQuitar}
          aria-label={`Quitar ${a.nombre}`}
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--color-tinta-suave)] hover:bg-[var(--color-hover)] hover:text-[var(--color-tinta)]"
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </span>
  );
}

function BotonCopiar({ texto }: { texto: string }) {
  const [hecho, setHecho] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setHecho(true);
          setTimeout(() => setHecho(false), 1500);
        } catch {
          // sin permiso de portapapeles
        }
      }}
      className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-[var(--color-hover)] hover:text-[var(--color-tinta)]"
    >
      {hecho ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      {hecho ? "Copiado" : "Copiar"}
    </button>
  );
}

function Respuesta({ m }: { m: Mensaje }) {
  const trabajando = m.estado === "trabajando";
  const borradores = Object.entries(m.borradores ?? {}) as [IA, { texto?: string; error?: string }][];
  return (
    <div className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--color-ambar)] text-[var(--color-sobre-ambar)]"
      >
        <Sparkles size={16} />
      </span>
      <div className="min-w-0 flex-1">
        {m.texto ? (
          <Markdown texto={m.texto} />
        ) : trabajando ? (
          <p className="flex items-center gap-2 py-1 text-[14px] text-[var(--color-tinta-suave)]">
            <Loader2 size={15} className="animate-spin" aria-hidden />
            {m.avance ?? "Pensando…"}
          </p>
        ) : null}

        {trabajando && m.texto && m.avance && (
          <p className="mt-1 flex items-center gap-2 text-xs text-[var(--color-tinta-suave)]">
            <Loader2 size={12} className="animate-spin" aria-hidden />
            {m.avance}
          </p>
        )}

        {m.estado === "error" && (
          <p
            role="alert"
            className="mt-1 flex items-start gap-2 rounded-[6px] bg-[var(--color-alerta-fondo)] px-3 py-2.5 text-[13px] text-[var(--color-alerta)]"
          >
            <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
            {m.error}
          </p>
        )}
        {m.estado === "detenido" && (
          <p className="mt-1 text-xs text-[var(--color-tinta-suave)]">Respuesta detenida.</p>
        )}
        {m.aviso && (
          <p className="mt-2 flex items-start gap-2 rounded-[6px] bg-[var(--color-aviso-fondo)] px-3 py-2 text-xs text-[var(--color-aviso-tinta)]">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
            {m.aviso}
          </p>
        )}

        {m.estado === "listo" && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-tinta-suave)]">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-relleno)] px-2 py-0.5">
              <Sparkles size={11} aria-hidden />
              {(m.fuentes ?? []).map((f) => NOMBRE_IA[f]).join(" + ")}
            </span>
            <BotonCopiar texto={m.texto} />
          </div>
        )}

        {borradores.length > 0 && !trabajando && (
          <details className="group mt-2">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-[var(--color-tinta-suave)] hover:text-[var(--color-tinta)]">
              <ChevronDown size={13} className="transition-transform group-open:rotate-180" aria-hidden />
              Ver lo que respondió cada IA
            </summary>
            <div className="mt-2 grid gap-3 lg:grid-cols-2">
              {borradores.map(([ia, b]) => (
                <div key={ia} className="min-w-0 rounded-[6px] border border-[var(--color-linea)] bg-[var(--color-sutil)] px-3.5 py-3">
                  <p className="rotulo mb-1.5">{NOMBRE_IA[ia]}</p>
                  {b.texto ? (
                    <div className="text-[13px]">
                      <Markdown texto={b.texto} />
                    </div>
                  ) : (
                    <p className="text-[13px] text-[var(--color-alerta)]">{b.error}</p>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pantalla

export default function AsistenteIA() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [modo, setModo] = useState<Modo>("combinado");
  const [cargado, setCargado] = useState(false);
  const [texto, setTexto] = useState("");
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  const [trabajando, setTrabajando] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const control = useRef<AbortController | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const selector = useRef<HTMLInputElement>(null);
  const pegadoAbajo = useRef(true);

  // La conversación de esta pestaña, si había una.
  useEffect(() => {
    const g = leerGuardado();
    setMensajes(g.mensajes);
    setModo(g.modo);
    setCargado(true);
  }, []);

  useEffect(() => {
    if (cargado) guardar(mensajes, modo);
  }, [mensajes, modo, cargado]);

  // Bajar sola mientras llega la respuesta, salvo que la persona haya subido a leer.
  useEffect(() => {
    const el = lista.current;
    if (el && pegadoAbajo.current) el.scrollTop = el.scrollHeight;
  }, [mensajes]);

  // Al salir de la sección se corta lo que esté respondiendo.
  useEffect(() => () => control.current?.abort(), []);

  // El campo crece con el texto, hasta unas ocho líneas.
  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [texto]);

  const cambiarMensaje = useCallback((id: string, cambio: (m: Mensaje) => Mensaje) => {
    setMensajes((lista) => lista.map((m) => (m.id === id ? cambio(m) : m)));
  }, []);

  // ---------------------------------------------------------- archivos
  async function agregarArchivos(archivos: File[]) {
    setAviso(null);
    const cupo = MAX_ADJUNTOS - adjuntos.length;
    if (archivos.length > cupo) setAviso(`Máximo ${MAX_ADJUNTOS} archivos por mensaje.`);

    for (const archivo of archivos.slice(0, Math.max(0, cupo))) {
      const id = nuevoId();
      const tipo: TipoAdjunto = archivo.type.startsWith("image/")
        ? "imagen"
        : /\.pdf$/i.test(archivo.name)
          ? "pdf"
          : "texto";
      setAdjuntos((a) => [...a, { id, tipo, nombre: archivo.name, estado: "preparando", peso: archivo.size }]);

      const listo = await preparar(archivo);
      if (!listo.ok) {
        setAdjuntos((a) => a.map((x) => (x.id === id ? { ...x, estado: "error", error: listo.error } : x)));
        continue;
      }
      if (listo.tipo === "texto") {
        setAdjuntos((a) =>
          a.map((x) => (x.id === id ? { ...x, tipo: "texto", estado: "listo", contenido: listo.contenido } : x))
        );
        continue;
      }

      // Imagen o PDF: a Gemini, para poder volver a preguntarle sin mandarlo otra vez.
      const datos = new FormData();
      datos.append("archivo", new File([listo.blob], listo.nombre, { type: listo.mime }));
      let uri: string | undefined;
      let error: string | undefined;
      try {
        const r = await fetch("/api/admin/asistente/archivo", { method: "POST", body: datos });
        const j = await r.json().catch(() => ({}));
        if (r.ok) uri = j.uri;
        else error = j.error ?? "No se pudo subir el archivo.";
      } catch {
        error = "No se pudo subir el archivo.";
      }

      setAdjuntos((a) =>
        a.map((x) => {
          if (x.id !== id) return x;
          const base = {
            ...x,
            tipo: listo.tipo,
            nombre: listo.nombre,
            mime: listo.mime,
            peso: listo.blob.size,
            miniatura: listo.tipo === "imagen" ? listo.miniatura : undefined,
            base64: listo.tipo === "imagen" && listo.base64 ? listo.base64 : undefined,
          };
          if (uri) return { ...base, estado: "listo", uri };
          // Sin Gemini, una imagen todavía la puede ver DeepSeek en este mensaje.
          if (listo.tipo === "imagen" && base.base64) {
            return { ...base, estado: "listo", error: `Solo la verá DeepSeek: ${error}` };
          }
          return { ...base, estado: "error", error };
        })
      );
    }
  }

  // ---------------------------------------------------------- enviar
  async function enviar(textoForzado?: string) {
    const pregunta = (textoForzado ?? texto).trim();
    const listos = adjuntos.filter((a) => a.estado === "listo");
    if (trabajando || (!pregunta && listos.length === 0)) return;
    if (adjuntos.some((a) => a.estado === "preparando")) {
      setAviso("Espera a que terminen de cargar los archivos.");
      return;
    }

    setAviso(null);
    const usuario: Mensaje = { id: nuevoId(), rol: "usuario", texto: pregunta, adjuntos: listos };
    const respuesta: Mensaje = {
      id: nuevoId(),
      rol: "asistente",
      texto: "",
      adjuntos: [],
      estado: "trabajando",
      avance: "Pensando…",
    };
    const historia = [...mensajes.filter((m) => m.estado !== "error" && m.estado !== "trabajando"), usuario];

    setMensajes((m) => [...m, usuario, respuesta]);
    setTexto("");
    setAdjuntos([]);
    setTrabajando(true);
    pegadoAbajo.current = true;

    const cuerpo = {
      modo,
      mensajes: historia
        .filter((m) => m.rol === "usuario" || m.texto)
        .map((m) => ({
          rol: m.rol,
          texto: m.texto,
          adjuntos: m.adjuntos.flatMap((a): AdjuntoEnvio[] =>
            a.tipo === "texto"
              ? [{ tipo: "texto", nombre: a.nombre, contenido: a.contenido ?? "" }]
              : a.uri
                ? [{ tipo: "archivo", nombre: a.nombre, mime: a.mime ?? "", uri: a.uri }]
                : []
          ),
        })),
      imagenes: listos
        .filter((a) => a.tipo === "imagen" && a.base64)
        .map((a) => ({ nombre: a.nombre, mime: "image/jpeg", datos: a.base64 })),
    };

    const ctl = new AbortController();
    control.current = ctl;

    try {
      const r = await fetch("/api/admin/asistente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
        signal: ctl.signal,
      });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? "No se pudo responder.");
      }

      const lector = r.body.getReader();
      const decodificador = new TextDecoder();
      let pendiente = "";
      let terminado = false;

      while (true) {
        const { done, value } = await lector.read();
        if (done) break;
        pendiente += decodificador.decode(value, { stream: true });
        let corte: number;
        while ((corte = pendiente.indexOf("\n")) !== -1) {
          const linea = pendiente.slice(0, corte);
          pendiente = pendiente.slice(corte + 1);
          if (!linea.trim()) continue;
          const e = JSON.parse(linea);
          if (e.t === "estado") cambiarMensaje(respuesta.id, (m) => ({ ...m, avance: e.texto }));
          else if (e.t === "texto") cambiarMensaje(respuesta.id, (m) => ({ ...m, texto: m.texto + e.texto }));
          else if (e.t === "borrador")
            cambiarMensaje(respuesta.id, (m) => ({
              ...m,
              borradores: { ...m.borradores, [e.ia]: { texto: e.texto, error: e.error } },
            }));
          else if (e.t === "fin") {
            terminado = true;
            cambiarMensaje(respuesta.id, (m) => ({ ...m, estado: "listo", fuentes: e.fuentes, aviso: e.aviso, avance: undefined }));
          } else if (e.t === "error") {
            terminado = true;
            cambiarMensaje(respuesta.id, (m) => ({ ...m, estado: "error", error: e.mensaje, avance: undefined }));
          }
        }
      }
      if (!terminado) {
        cambiarMensaje(respuesta.id, (m) =>
          m.texto
            ? { ...m, estado: "detenido", avance: undefined }
            : { ...m, estado: "error", error: "La respuesta se cortó. Intenta de nuevo.", avance: undefined }
        );
      }
    } catch (e) {
      if (ctl.signal.aborted) {
        cambiarMensaje(respuesta.id, (m) => ({ ...m, estado: "detenido", avance: undefined }));
      } else {
        cambiarMensaje(respuesta.id, (m) => ({
          ...m,
          estado: "error",
          error: (e as Error).message || "No se pudo responder.",
          avance: undefined,
        }));
      }
    } finally {
      setTrabajando(false);
      control.current = null;
      campo.current?.focus();
    }
  }

  function nuevaConversacion() {
    control.current?.abort();
    setMensajes([]);
    setAdjuntos([]);
    setTexto("");
    setAviso(null);
  }

  const vacio = mensajes.length === 0;
  const puedeEnviar =
    !trabajando &&
    (texto.trim().length > 0 || adjuntos.some((a) => a.estado === "listo")) &&
    !adjuntos.some((a) => a.estado === "preparando");

  return (
    <div className="flex h-[calc(100dvh-140px)] min-h-[480px] flex-col gap-3 lg:h-[calc(100dvh-150px)]">
      {/* ---------------------------------------------------------- encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.01em] sm:text-[26px]">Asistente IA</h1>
          <p className="mt-0.5 text-[13px] text-[var(--color-tinta-suave)]">
            Pregunta lo que quieras o adjunta imágenes, PDF, Word, Excel o texto.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="asistente-modo" className="sr-only">
            Qué IA responde
          </label>
          <div className="w-[200px]">
            <select
              id="asistente-modo"
              value={modo}
              onChange={(e) => setModo(e.target.value as Modo)}
              disabled={trabajando}
              className="campo py-2 text-[14px]"
              title={MODOS.find((m) => m.id === modo)?.detalle}
            >
              {MODOS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={nuevaConversacion}
            disabled={vacio && !texto && adjuntos.length === 0}
            className="boton boton-secundario"
            aria-label="Nueva conversación"
            title="Nueva conversación"
          >
            <Plus size={16} aria-hidden />
            <span className="hidden sm:inline">Nueva</span>
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------- conversación */}
      <section
        aria-label="Conversación"
        className="tarjeta relative flex min-h-0 flex-1 flex-col overflow-hidden"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setArrastrando(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setArrastrando(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          agregarArchivos([...e.dataTransfer.files]);
        }}
      >
        <div
          ref={lista}
          onScroll={(e) => {
            const el = e.currentTarget;
            pegadoAbajo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"
        >
          {vacio ? (
            <div className="mx-auto flex h-full max-w-[560px] flex-col items-center justify-center text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--color-ambar)] text-[var(--color-sobre-ambar)]">
                <Sparkles size={22} aria-hidden />
              </span>
              <p className="mt-3 text-[18px] font-semibold">¿En qué te ayudo?</p>
              <p className="mt-1 text-[13px] text-[var(--color-tinta-suave)]">
                {MODOS.find((m) => m.id === modo)?.detalle}. Puedes arrastrar archivos aquí o pegar una imagen.
              </p>
              <div className="mt-5 grid w-full gap-2 sm:grid-cols-2">
                {SUGERENCIAS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setTexto(s);
                      campo.current?.focus();
                    }}
                    className="rounded-[6px] border border-[var(--color-linea)] px-3 py-2.5 text-left text-[13px] hover:border-[var(--color-tinta)] hover:bg-[var(--color-hover)]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-[860px] flex-col gap-6">
              {mensajes.map((m) =>
                m.rol === "usuario" ? (
                  <div key={m.id} className="flex flex-col items-end gap-2">
                    {m.adjuntos.length > 0 && (
                      <div className="flex max-w-full flex-wrap justify-end gap-1.5">
                        {m.adjuntos.map((a) => (
                          <ChipAdjunto key={a.id} a={a} />
                        ))}
                      </div>
                    )}
                    {m.texto && (
                      <p className="max-w-[85%] rounded-[14px] rounded-br-[4px] bg-[var(--color-tinta)] px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-[var(--color-sobre-tinta)]">
                        {m.texto}
                      </p>
                    )}
                  </div>
                ) : (
                  <Respuesta key={m.id} m={m} />
                )
              )}
            </div>
          )}
        </div>

        {arrastrando && (
          <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-[6px] border-2 border-dashed border-[var(--color-tinta)] bg-[color-mix(in_srgb,var(--color-papel)_85%,transparent)]">
            <p className="text-[15px] font-semibold">Suelta los archivos aquí</p>
          </div>
        )}

        {/* ---------------------------------------------------------- escribir */}
        <div className="border-t border-[var(--color-linea)] bg-[var(--color-papel)] px-3 py-3 sm:px-4">
          {aviso && (
            <p className="mb-2 flex items-center gap-2 text-xs text-[var(--color-aviso-tinta)]">
              <TriangleAlert size={13} aria-hidden />
              {aviso}
            </p>
          )}
          {adjuntos.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {adjuntos.map((a) => (
                <ChipAdjunto key={a.id} a={a} onQuitar={() => setAdjuntos((l) => l.filter((x) => x.id !== a.id))} />
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={selector}
              type="file"
              multiple
              accept={ACEPTA}
              className="sr-only"
              aria-label="Adjuntar archivos"
              onChange={(e) => {
                agregarArchivos([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => selector.current?.click()}
              disabled={adjuntos.length >= MAX_ADJUNTOS}
              aria-label="Adjuntar archivos"
              title="Adjuntar imágenes, PDF, Word, Excel o texto"
              className="boton boton-secundario h-[44px] w-[44px] shrink-0 px-0"
            >
              <Paperclip size={18} aria-hidden />
            </button>
            <label htmlFor="asistente-texto" className="sr-only">
              Tu pregunta
            </label>
            <textarea
              id="asistente-texto"
              ref={campo}
              rows={1}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  enviar();
                }
              }}
              onPaste={(e) => {
                const imagenes = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
                if (imagenes.length > 0) {
                  e.preventDefault();
                  agregarArchivos(imagenes.map((f, i) => new File([f], f.name || `pegada-${i + 1}.png`, { type: f.type })));
                }
              }}
              placeholder="Escribe tu pregunta…"
              className="campo max-h-[200px] min-h-[44px] flex-1 resize-none py-2.5"
            />
            {trabajando ? (
              <button
                type="button"
                onClick={() => control.current?.abort()}
                aria-label="Detener la respuesta"
                title="Detener"
                className="boton boton-secundario h-[44px] w-[44px] shrink-0 px-0"
              >
                <Square size={15} fill="currentColor" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => enviar()}
                disabled={!puedeEnviar}
                aria-label="Enviar"
                title="Enviar"
                className="boton boton-primario h-[44px] w-[44px] shrink-0 px-0"
              >
                <ArrowUp size={18} aria-hidden />
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--color-tinta-suave)]">
            <span className="hidden sm:inline">Enter envía; Mayús + Enter salta de línea. </span>
            Las IA se pueden equivocar: revisa cifras y datos importantes. No compartas claves ni datos sensibles.
          </p>
        </div>
      </section>
    </div>
  );
}
