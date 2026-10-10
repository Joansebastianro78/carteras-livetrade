"use client";

import { useEffect, useState } from "react";
import {
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Trash2,
  TriangleAlert,
  Pencil,
} from "lucide-react";
import type { Tablero } from "@/lib/tableros";
import VisorTableros from "./VisorTableros";

export default function PanelTableros() {
  const [lista, setLista] = useState<Tablero[] | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "mal"; texto: string } | null>(
    null
  );

  const [editando, setEditando] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [url, setUrl] = useState("");
  const [orden, setOrden] = useState(0);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const res = await fetch("/api/admin/tableros");
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo leer los tableros." });
      setLista([]);
      return;
    }
    setLista(json.tableros ?? []);
  }

  function limpiar() {
    setEditando(null);
    setNombre("");
    setDescripcion("");
    setUrl("");
    setOrden(0);
  }

  function editar(t: Tablero) {
    setAviso(null);
    setEditando(t.id);
    setNombre(t.nombre);
    setDescripcion(t.descripcion ?? "");
    setUrl(t.url);
    setOrden(t.orden);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setAviso(null);

    const res = await fetch("/api/admin/tableros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editando, nombre, descripcion, url, orden }),
    });
    const json = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo guardar." });
      return;
    }

    setAviso({
      tipo: "ok",
      texto: editando
        ? `Se actualizó ${json.tablero.nombre}.`
        : `Se agregó ${json.tablero.nombre}. Queda publicado para el perfil BackOffice.`,
    });
    limpiar();
    cargar();
  }

  async function publicar(t: Tablero) {
    const res = await fetch("/api/admin/tableros", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id, activo: !t.activo }),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo cambiar." });
      return;
    }
    cargar();
  }

  async function borrar(t: Tablero) {
    if (!confirm(`¿Eliminar el tablero "${t.nombre}"? El informe en Power BI no se toca.`))
      return;

    const res = await fetch("/api/admin/tableros", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id }),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo eliminar." });
      return;
    }
    if (editando === t.id) limpiar();
    cargar();
  }

  return (
    <div className="space-y-8">
      {/* El título y la explicación los pone el panel arriba. */}
      {aviso && (
        <p
          role="status"
          className={`rounded-[4px] px-3 py-2.5 text-[13px] leading-snug ${
            aviso.tipo === "ok"
              ? "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]"
              : "bg-[var(--color-alerta-fondo)] text-[var(--color-alerta)]"
          }`}
        >
          {aviso.texto}
        </p>
      )}

      <section>
        <h2 className="text-sm font-semibold">Tableros guardados</h2>

        {lista === null ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-[var(--color-tinta-suave)]">
            <Loader2 size={15} className="animate-spin" aria-hidden />
            Cargando…
          </p>
        ) : lista.length === 0 ? (
          <p className="mt-2 rounded-[4px] border border-dashed border-[var(--color-linea)] px-4 py-6 text-center text-[13px] text-[var(--color-tinta-suave)]">
            Todavía no hay ninguno. Agrega el primero abajo.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--color-linea)] rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)]">
            {lista.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
              >
                <span className="min-w-[15rem] flex-1">
                  <span className="block text-sm font-medium">{t.nombre}</span>
                  <span className="mt-0.5 block text-xs leading-snug break-all text-[var(--color-tinta-suave)]">
                    {t.descripcion ? `${t.descripcion} · ` : ""}
                    {t.url}
                  </span>
                </span>

                <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                      t.activo
                        ? "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]"
                        : "bg-[var(--color-relleno)] text-[var(--color-tinta-suave)]"
                    }`}
                  >
                    {t.activo ? "publicado" : "sin publicar"}
                  </span>

                  <button
                    type="button"
                    onClick={() => editar(t)}
                    className="boton boton-secundario boton-chico"
                  >
                    <Pencil size={13} aria-hidden />
                    Editar
                  </button>

                  <button
                    type="button"
                    onClick={() => publicar(t)}
                    className="boton boton-secundario boton-chico"
                  >
                    {t.activo ? (
                      <EyeOff size={13} aria-hidden />
                    ) : (
                      <Eye size={13} aria-hidden />
                    )}
                    {t.activo ? "Ocultar" : "Publicar"}
                  </button>

                  <button
                    type="button"
                    onClick={() => borrar(t)}
                    className="boton boton-secundario boton-chico text-[var(--color-alerta)] hover:border-[var(--color-alerta)]"
                  >
                    <Trash2 size={13} aria-hidden />
                    Eliminar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold">
          {editando ? "Editar tablero" : "Agregar un tablero"}
        </h2>

        <form onSubmit={guardar} className="tarjeta mt-2 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="tablero-nombre" className="campo-etiqueta">
                Nombre
              </label>
              <input
                id="tablero-nombre"
                required
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Cumplimiento de visitas"
                className="campo"
              />
            </div>

            <div>
              <label htmlFor="tablero-descripcion" className="campo-etiqueta">
                Descripción (opcional)
              </label>
              <input
                id="tablero-descripcion"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Avance del ciclo por consultor"
                className="campo"
              />
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="tablero-url" className="campo-etiqueta">
              Enlace de Power BI
            </label>
            <textarea
              id="tablero-url"
              required
              rows={3}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://app.powerbi.com/reportEmbed?reportId=…"
              className="campo resize-y break-all"
            />
            <p className="mt-1.5 text-xs leading-snug text-[var(--color-tinta-suave)]">
              Sirve la URL pelada o el código <code>&lt;iframe&gt;</code> que da
              el botón Insertar de Power BI: si pegas el código, se le saca el
              enlace solo. Solo se aceptan direcciones de powerbi.com.
            </p>
          </div>

          <div className="mt-4 max-w-[10rem]">
            <label htmlFor="tablero-orden" className="campo-etiqueta">
              Orden
            </label>
            <input
              id="tablero-orden"
              type="number"
              value={orden}
              onChange={(e) => setOrden(Number(e.target.value))}
              className="campo cifras"
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={guardando || !nombre || !url}
              className="boton boton-primario"
            >
              {guardando ? (
                <Loader2 size={15} className="animate-spin" aria-hidden />
              ) : (
                <Plus size={15} aria-hidden />
              )}
              {editando ? "Guardar cambios" : "Agregar tablero"}
            </button>

            {editando && (
              <button
                type="button"
                onClick={limpiar}
                className="boton boton-secundario"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>

        <p className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
          {/* En un span: suelto, cada trozo de texto sería una columna del flex. */}
          <span>
            Con enlaces de tipo <code>autoAuth=true</code> cada persona ve el
            informe con su propia cuenta de Microsoft, y tiene que estar con sesión
            abierta en ese mismo navegador. Si el informe no carga dentro de la
            página, casi siempre es eso o que el tenant bloquea la incrustación:
            ahí sirve el botón Abrir en Power BI.
          </span>
        </p>
      </section>

      {lista && lista.length > 0 && (
        <section className="border-t border-[var(--color-linea)] pt-6">
          <h2 className="text-sm font-semibold">Así lo ve el BackOffice</h2>
          <div className="mt-2">
            <VisorTableros />
          </div>
        </section>
      )}
    </div>
  );
}
