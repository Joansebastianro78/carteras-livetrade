"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import {
  rangoLegible,
  TEMAS,
  type EstadoTema,
  type IdTema,
  type ModoTema,
} from "@/lib/temas";

const MODOS: { id: ModoTema; titulo: string; detalle: string }[] = [
  {
    id: "automatico",
    titulo: "Automático",
    detalle:
      "Cada tema aparece solo cuando llegan sus fechas y se retira al terminar. Es lo normal.",
  },
  {
    id: "fijo",
    titulo: "Dejar uno fijo",
    detalle:
      "Muestra siempre el tema que elijas, sin mirar el calendario. Útil para probarlo o para un evento.",
  },
  {
    id: "apagado",
    titulo: "Sin decoración",
    detalle: "La página queda limpia todo el año.",
  },
];

export default function PanelTemas() {
  const [modo, setModo] = useState<ModoTema>("automatico");
  const [temaFijo, setTemaFijo] = useState<IdTema | "">("");
  const [apagados, setApagados] = useState<IdTema[]>([]);
  const [activo, setActivo] = useState<IdTema | null>(null);

  const [cargado, setCargado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "mal"; texto: string } | null>(
    null
  );

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const res = await fetch("/api/admin/tema");
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo leer los temas." });
      setCargado(true);
      return;
    }

    const estado = json.estado as EstadoTema;
    setModo(estado.modo);
    setTemaFijo(estado.temaFijo ?? "");
    setApagados(estado.apagados ?? []);
    setActivo(json.activo ?? null);
    setCargado(true);
  }

  async function guardar(cambios?: Partial<EstadoTema>) {
    setGuardando(true);
    setAviso(null);

    const cuerpo = {
      modo: cambios?.modo ?? modo,
      temaFijo: cambios?.temaFijo ?? (temaFijo || null),
      apagados: cambios?.apagados ?? apagados,
    };

    const res = await fetch("/api/admin/tema", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const json = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo guardar." });
      return;
    }

    setActivo(json.activo ?? null);
    setAviso({
      tipo: "ok",
      texto: json.activo
        ? `Guardado. Ahora mismo se está viendo ${
            TEMAS.find((t) => t.id === json.activo)?.nombre
          }; recarga la página pública para comprobarlo.`
        : "Guardado. En este momento la página no muestra decoración.",
    });
  }

  function alternarTema(id: IdTema) {
    const nuevos = apagados.includes(id)
      ? apagados.filter((x) => x !== id)
      : [...apagados, id];

    setApagados(nuevos);
    guardar({ apagados: nuevos });
  }

  if (!cargado) {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--color-tinta-suave)]">
        <Loader2 size={15} className="animate-spin" aria-hidden />
        Cargando…
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* El título y la explicación los pone el panel arriba. */}
      <div>
        <p
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium ${
            activo
              ? "bg-[var(--color-morado-fondo)] text-[var(--color-morado-tinta)]"
              : "bg-[var(--color-relleno)] text-[var(--color-tinta-suave)]"
          }`}
        >
          <Sparkles size={14} aria-hidden />
          {activo
            ? `Hoy se ve: ${TEMAS.find((t) => t.id === activo)?.nombre}`
            : "Hoy la página está sin decoración"}
        </p>

        {aviso && (
          <p
            role="status"
            className={`mt-3 rounded-[4px] px-3 py-2.5 text-[13px] leading-snug ${
              aviso.tipo === "ok"
                ? "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]"
                : "bg-[var(--color-alerta-fondo)] text-[var(--color-alerta)]"
            }`}
          >
            {aviso.texto}
          </p>
        )}
      </div>

      <section className="tarjeta p-5">
        <h2 className="text-sm font-semibold">Cuándo mostrarlos</h2>
        <div className="mt-2 space-y-2">
          {MODOS.map((m) => (
            <label
              key={m.id}
              className={`flex cursor-pointer gap-3 rounded-[4px] border p-3 ${
                modo === m.id
                  ? "border-[var(--color-tinta)] bg-[var(--color-sutil)]"
                  : "border-[var(--color-linea)]"
              }`}
            >
              <input
                type="radio"
                name="modo-tema"
                checked={modo === m.id}
                onChange={() => {
                  setModo(m.id);
                  // Cambiar a "fijo" sin tema elegido no se guarda todavía:
                  // el selector de abajo aparece y ahí se confirma.
                  if (m.id !== "fijo") guardar({ modo: m.id });
                  else if (temaFijo) guardar({ modo: m.id, temaFijo });
                }}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium">{m.titulo}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-[var(--color-tinta-suave)]">
                  {m.detalle}
                </span>
              </span>
            </label>
          ))}
        </div>

        {modo === "fijo" && (
          <div className="mt-3">
            <label htmlFor="tema-fijo" className="campo-etiqueta">
              Cuál dejar fijo
            </label>
            <select
              id="tema-fijo"
              value={temaFijo}
              onChange={(e) => {
                const id = e.target.value as IdTema;
                setTemaFijo(id);
                if (id) guardar({ modo: "fijo", temaFijo: id });
              }}
              className="campo"
            >
              <option value="">Elige un tema</option>
              {TEMAS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section className="tarjeta p-5">
        <h2 className="text-sm font-semibold">Cuáles están habilitados</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
          Un tema deshabilitado no sale aunque lleguen sus fechas.
        </p>

        <ul className="mt-3 divide-y divide-[var(--color-linea)] rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)]">
          {TEMAS.map((t) => {
            const encendido = !apagados.includes(t.id);

            return (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
              >
                <span className="min-w-[15rem] flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {t.nombre}
                    {activo === t.id && (
                      <CheckCircle2
                        size={14}
                        className="text-[var(--color-exito)]"
                        aria-label="Es el que se está viendo"
                      />
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-[var(--color-tinta-suave)]">
                    {rangoLegible(t)} · {t.decoracion}
                  </span>
                </span>

                <span className="flex items-center gap-2 sm:ml-auto">
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                      encendido
                        ? "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]"
                        : "bg-[var(--color-relleno)] text-[var(--color-tinta-suave)]"
                    }`}
                  >
                    {encendido ? "habilitado" : "deshabilitado"}
                  </span>

                  <button
                    type="button"
                    onClick={() => alternarTema(t.id)}
                    disabled={guardando}
                    className="boton boton-secundario boton-chico shrink-0"
                  >
                    {encendido ? "Deshabilitar" : "Habilitar"}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
          Para agregar otra fecha —la Independencia, el aniversario de la
          empresa— se añade al listado de <code>src/lib/temas.ts</code> con su
          rango y su adorno; el panel la recoge sola.
        </p>
      </section>
    </div>
  );
}
