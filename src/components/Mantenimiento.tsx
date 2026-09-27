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
    setAviso({
      tipo: "ok",
      texto: activo
        ? "Ventana abierta: la página pública ya muestra el aviso."
        : "Ventana cerrada: los vendedores vuelven a consultar.",
    });
  }

  const activo = estado?.activo === true;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold">Ventana de mantenimiento</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
          Mientras esté abierta, la página pública muestra un aviso en vez del
          formulario y nadie puede consultar su cartera. Este panel sigue
          funcionando: úsalo para cargar el Excel con calma y ciérrala al terminar.
        </p>
      </section>

      <section
        className={`rounded-[4px] border p-5 ${
          activo
            ? "border-[#e0b970] bg-[#fdf4e3]"
            : "border-[var(--color-linea)] bg-[var(--color-papel)]"
        }`}
      >
        <p className="flex items-center gap-2 text-sm font-semibold">
          {activo ? (
            <>
              <Wrench size={16} className="text-[#7a5410]" aria-hidden />
              <span className="text-[#7a5410]">La página está en mantenimiento</span>
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
              Mensaje que ve el vendedor
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
                ? "bg-[#e7f2ec] text-[var(--color-exito)]"
                : "bg-[#f8ecea] text-[var(--color-alerta)]"
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
                className="flex items-center gap-2 rounded-[4px] bg-[var(--color-exito)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-45"
              >
                {guardando && <Loader2 size={15} className="animate-spin" aria-hidden />}
                Cerrar la ventana y abrir la página
              </button>
              <button
                type="button"
                onClick={() => guardar(true)}
                disabled={guardando}
                className="rounded-[4px] border border-[var(--color-linea)] px-4 py-2.5 text-sm disabled:opacity-45"
              >
                Guardar el mensaje
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => guardar(true)}
              disabled={guardando}
              className="flex items-center gap-2 rounded-[4px] bg-[#7a5410] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-45"
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
