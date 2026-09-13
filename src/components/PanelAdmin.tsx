"use client";

import { useState } from "react";
import Cargador from "./Cargador";
import EditorCartera from "./EditorCartera";
import AdminUsuarios from "./AdminUsuarios";

const SECCIONES = [
  { id: "cargar", titulo: "Cargar plantilla" },
  { id: "editar", titulo: "Editar cartera" },
  { id: "usuarios", titulo: "Administradores" },
] as const;

type Seccion = (typeof SECCIONES)[number]["id"];

export default function PanelAdmin() {
  const [activa, setActiva] = useState<Seccion>("cargar");

  return (
    <>
      <nav
        aria-label="Secciones del panel"
        className="flex gap-1 border-b border-[var(--color-linea)]"
      >
        {SECCIONES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiva(s.id)}
            aria-current={activa === s.id ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm ${
              activa === s.id
                ? "border-[var(--color-tinta)] font-medium text-[var(--color-tinta)]"
                : "border-transparent text-[var(--color-tinta-suave)] hover:text-[var(--color-tinta)]"
            }`}
          >
            {s.titulo}
          </button>
        ))}
      </nav>

      <div className="pt-7">
        {activa === "cargar" && (
          <>
            <Cargador />

            <section className="mt-10 border-t border-[var(--color-linea)] pt-6">
              <h2 className="text-sm font-semibold text-[var(--color-tinta)]">
                Qué pasa cuando cargas un archivo
              </h2>
              <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
                <li>
                  Cada punto se identifica por ID de PDV más ciclo. Si el punto ya
                  existe en ese ciclo se actualiza; si no, se crea. Cargar dos veces
                  el mismo archivo no duplica registros.
                </li>
                <li>
                  Las coordenadas a las que el origen les perdió el punto decimal se
                  corrigen automáticamente. Las que quedan fuera de Colombia se
                  guardan sin ubicación y el vendedor las ve en la lista con una marca.
                </li>
                <li>
                  Las filas con ccuser en LIBRE se guardan igual, pero nadie puede
                  consultarlas desde la página pública.
                </li>
                <li>
                  El archivo se envía en lotes de 500 filas. Si un lote falla, el
                  proceso se detiene y se informa cuántas filas alcanzaron a guardarse.
                </li>
                <li>
                  Una carga nunca borra lo que ya está: solo agrega y actualiza. Para
                  sacar puntos viejos usa la pestaña de editar cartera.
                </li>
              </ul>
            </section>
          </>
        )}

        {activa === "editar" && <EditorCartera />}
        {activa === "usuarios" && <AdminUsuarios />}
      </div>
    </>
  );
}
