"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, TriangleAlert, Wrench } from "lucide-react";

type Estado = {
  activo: boolean;
  mensaje: string;
  hasta: string | null;
  actualizado_por: string | null;
  updated_at: string | null;
};

const MENSAJE_POR_DEFECTO =
  "Estamos actualizando la cartera. Vuelve a intentar en unos minutos.";

/** ISO → valor de un <input type="datetime-local"> en hora local del navegador. */
function aInputLocal(iso: string | null): string {
  if (!iso) return "";
  const f = new Date(iso);
  if (Number.isNaN(f.getTime())) return "";
  const desfase = f.getTimezoneOffset() * 60_000;
  return new Date(f.getTime() - desfase).toISOString().slice(0, 16);
}

export default function Mantenimiento() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [mensaje, setMensaje] = useState(MENSAJE_POR_DEFECTO);
  const [hasta, setHasta] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "mal"; texto: string } | null>(
    null
  );

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const res = await fetch("/api/admin/mantenimiento");
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo leer el estado." });
      return;
    }

    setEstado(json.estado);
    setMensaje(json.estado?.mensaje || MENSAJE_POR_DEFECTO);
    setHasta(aInputLocal(json.estado?.hasta ?? null));
  }

  async function guardar(activo: boolean) {
    setGuardando(true);
    setAviso(null);

    const res = await fetch("/api/admin/mantenimiento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activo,
        mensaje,
        // datetime-local entrega hora local sin zona; el Date del navegador la
        // interpreta bien y el servidor la guarda ya en UTC.
        hasta: hasta ? new Date(hasta).toISOString() : null,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo guardar." });
      return;
    }

    setEstado(json.estado);
    // El encabezado del panel muestra si la consulta está abierta: que se entere.
    window.dispatchEvent(new Event("cartera:estado"));
    setAviso({
      tipo: "ok",
      texto: activo
        ? "Ventana abierta: la página pública ya muestra el aviso."
        : "Ventana cerrada: los consultores vuelven a consultar.",
    });
  }

  const activo = estado?.activo === true;

  return (
    <div className="space-y-6">
      <section
        className={`tarjeta p-5 ${
          activo ? "border-[var(--color-aviso-borde)] bg-[var(--color-aviso-fondo)]" : ""
        }`}
      >
        <p className="flex items-center gap-2 text-sm font-semibold">
          {activo ? (
            <>
              <Wrench size={16} className="text-[var(--color-aviso-tinta)]" aria-hidden />
              <span className="text-[var(--color-aviso-tinta)]">
                La página está en mantenimiento
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 size={16} className="text-[var(--color-exito)]" aria-hidden />
              <span className="text-[var(--color-exito)]">La página está abierta</span>
            </>
          )}
        </p>

        {estado?.updated_at && (
          <p className="cifras mt-1.5 text-xs text-[var(--color-tinta-suave)]">
            Último cambio: {new Date(estado.updated_at).toLocaleString("es-CO")}
            {estado.actualizado_por ? ` · ${estado.actualizado_por}` : ""}
          </p>
        )}

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="mensaje-mantenimiento" className="campo-etiqueta">
              Mensaje que ve el consultor
            </label>
            <textarea
              id="mensaje-mantenimiento"
              rows={3}
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              className="campo resize-y"
              placeholder={MENSAJE_POR_DEFECTO}
            />
          </div>

          <div>
            <label htmlFor="hasta-mantenimiento" className="campo-etiqueta">
              Hasta cuándo (opcional)
            </label>
            <input
              id="hasta-mantenimiento"
              type="datetime-local"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="campo cifras"
            />
            <p className="mt-1.5 text-xs leading-snug text-[var(--color-tinta-suave)]">
              Solo se muestra como referencia. La ventana no se cierra sola: si la
              carga se demora, la página sigue protegida hasta que la cierres aquí.
            </p>
          </div>
        </div>

        {aviso && (
          <p
            role="status"
            className={`mt-4 rounded-[4px] px-3 py-2.5 text-[13px] ${
              aviso.tipo === "ok"
                ? "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]"
                : "bg-[var(--color-alerta-fondo)] text-[var(--color-alerta)]"
            }`}
          >
            {aviso.texto}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {activo ? (
            <>
              <button
                type="button"
                onClick={() => guardar(false)}
                disabled={guardando}
                className="boton bg-[var(--color-exito)] text-[var(--color-sobre-exito)]"
              >
                {guardando && <Loader2 size={15} className="animate-spin" aria-hidden />}
                Cerrar la ventana y abrir la página
              </button>
              <button
                type="button"
                onClick={() => guardar(true)}
                disabled={guardando}
                className="boton boton-secundario"
              >
                Guardar el mensaje
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => guardar(true)}
              disabled={guardando}
              className="boton bg-[var(--color-aviso-tinta)] text-[var(--color-sobre-aviso)]"
            >
              {guardando ? (
                <Loader2 size={15} className="animate-spin" aria-hidden />
              ) : (
                <Wrench size={15} aria-hidden />
              )}
              Poner la página en mantenimiento
            </button>
          )}
        </div>
      </section>

      <p className="flex items-start gap-2 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
        <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
        Si la tabla de mantenimiento no existe o falla la lectura, la página se
        queda abierta a propósito: es preferible a dejar sin cartera a todo el
        mundo por un error de base de datos.
      </p>
    </div>
  );
}
