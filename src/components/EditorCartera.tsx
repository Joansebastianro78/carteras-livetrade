"use client";

import { useEffect, useState } from "react";
import { Loader2, Search, Trash2, TriangleAlert } from "lucide-react";
import { FRASE_PURGA } from "@/lib/tipos";

type Punto = {
  id_registro: number;
  id_pdv: string;
  bavaria: string | null;
  pdv: string | null;
  direccion: string | null;
  persona_hacku: string | null;
  celular: string | null;
  que_hacer: string | null;
  ciclo: string;
  ruta: number | null;
  num_de_ruta: number | null;
  usuario: string;
  ccuser: string;
  nom: string | null;
  persona: string | null;
  latitud: number | null;
  longitud: number | null;
};

type Ciclo = {
  ciclo: string;
  puntos: number;
  vendedores: number;
  sin_ubicacion: number;
  ultima_actualizacion: string | null;
};

const CAMPOS: { clave: keyof Punto; etiqueta: string; tipo?: string }[] = [
  { clave: "pdv", etiqueta: "Nombre del PDV" },
  { clave: "direccion", etiqueta: "Dirección" },
  { clave: "persona_hacku", etiqueta: "Persona de contacto" },
  { clave: "celular", etiqueta: "Celular" },
  { clave: "que_hacer", etiqueta: "Tarea" },
  { clave: "ruta", etiqueta: "Ruta (color en el mapa)", tipo: "number" },
  { clave: "num_de_ruta", etiqueta: "Ruta del vendedor", tipo: "number" },
  { clave: "usuario", etiqueta: "Usuario asignado" },
  { clave: "ccuser", etiqueta: "Cédula asignada" },
  { clave: "nom", etiqueta: "Nombre del vendedor" },
  { clave: "latitud", etiqueta: "Latitud" },
  { clave: "longitud", etiqueta: "Longitud" },
];

export default function EditorCartera() {
  const [q, setQ] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<Punto[] | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [borrador, setBorrador] = useState<Partial<Punto>>({});
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "mal"; texto: string } | null>(null);

  const [ciclos, setCiclos] = useState<Ciclo[] | null>(null);
  const [cicloElegido, setCicloElegido] = useState<string>("");
  const [confirmacion, setConfirmacion] = useState("");
  const [purgando, setPurgando] = useState(false);

  useEffect(() => {
    cargarCiclos();
  }, []);

  async function cargarCiclos() {
    const res = await fetch("/api/admin/purgar");
    const json = await res.json().catch(() => ({}));
    if (res.ok) setCiclos(json.ciclos ?? []);
  }

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    setBuscando(true);
    setAviso(null);
    setAbierto(null);

    const res = await fetch(`/api/admin/puntos?q=${encodeURIComponent(q)}`);
    const json = await res.json().catch(() => ({}));
    setBuscando(false);

    if (!res.ok) {
      setResultados(null);
      setAviso({ tipo: "mal", texto: json.error ?? "Falló la búsqueda." });
      return;
    }
    setResultados(json.puntos ?? []);
  }

  function abrir(p: Punto) {
    if (abierto === p.id_registro) {
      setAbierto(null);
      return;
    }
    setAbierto(p.id_registro);
    setBorrador({ ...p });
    setAviso(null);
  }

  async function guardar(id: number) {
    setGuardando(true);
    setAviso(null);

    const cambios: Record<string, unknown> = {};
    for (const { clave } of CAMPOS) cambios[clave] = borrador[clave] ?? null;

    const res = await fetch("/api/admin/puntos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_registro: id, cambios }),
    });
    const json = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo guardar." });
      return;
    }

    setResultados(
      (prev) =>
        prev?.map((p) =>
          p.id_registro === id ? ({ ...p, ...borrador } as Punto) : p
        ) ?? null
    );
    setAbierto(null);
    setAviso({ tipo: "ok", texto: "Punto actualizado." });
  }

  async function eliminar(p: Punto) {
    const nombre = p.pdv ?? p.id_pdv;
    if (!confirm(`¿Eliminar "${nombre}"? Esta acción no se puede deshacer.`)) return;

    const res = await fetch(`/api/admin/puntos?id_registro=${p.id_registro}`, {
      method: "DELETE",
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo eliminar." });
      return;
    }

    setResultados((prev) => prev?.filter((x) => x.id_registro !== p.id_registro) ?? null);
    setAviso({ tipo: "ok", texto: `Se eliminó ${nombre}.` });
    cargarCiclos();
  }

  async function purgar() {
    setPurgando(true);
    setAviso(null);

    const res = await fetch("/api/admin/purgar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ciclo: cicloElegido || null,
        confirmacion,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setPurgando(false);

    if (!res.ok) {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo eliminar." });
      return;
    }

    setConfirmacion("");
    setResultados(null);
    setAviso({ tipo: "ok", texto: `Se eliminaron ${json.eliminados} puntos.` });
    cargarCiclos();
  }

  const fraseEsperada = cicloElegido || FRASE_PURGA;
  const total = ciclos?.reduce((a, c) => a + c.puntos, 0) ?? 0;

  return (
    <div className="space-y-10">
      {/* ---------------------------------------------------- buscar y editar */}
      <section>
        <h2 className="text-sm font-semibold">Buscar un punto</h2>
        <p className="mt-1 text-[13px] text-[var(--color-tinta-suave)]">
          Por ID, código Bavaria, nombre del PDV, dirección, usuario o cédula.
        </p>

        <form onSubmit={buscar} className="mt-3 flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="BAV172, 5249839 o DONDE HUGO"
            className="campo"
            aria-label="Texto a buscar"
          />
          <button
            type="submit"
            disabled={buscando || q.trim().length < 2}
            className="flex shrink-0 items-center gap-2 rounded-[4px] bg-[var(--color-tinta)] px-4 text-sm font-medium text-white disabled:opacity-45"
          >
            {buscando ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <Search size={15} aria-hidden />
            )}
            Buscar
          </button>
        </form>

        {aviso && (
          <p
            role="status"
            className={`mt-3 rounded-[4px] px-3 py-2.5 text-[13px] ${
              aviso.tipo === "ok"
                ? "bg-[#e7f2ec] text-[var(--color-exito)]"
                : "bg-[#f8ecea] text-[var(--color-alerta)]"
            }`}
          >
            {aviso.texto}
          </p>
        )}

        {resultados !== null && resultados.length === 0 && (
          <p className="mt-4 rounded-[4px] border border-dashed border-[var(--color-linea)] px-4 py-6 text-center text-[13px] text-[var(--color-tinta-suave)]">
            Ningún punto coincide con esa búsqueda.
          </p>
        )}

        {resultados && resultados.length > 0 && (
          <>
            <p className="mt-4 text-xs text-[var(--color-tinta-suave)]">
              {resultados.length === 60
                ? "Se muestran los primeros 60. Afina la búsqueda si no ves el punto."
                : `${resultados.length} resultado(s).`}
            </p>

            <ul className="mt-2 divide-y divide-[var(--color-linea)] rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)]">
              {resultados.map((p) => (
                <li key={p.id_registro}>
                  <div className="flex items-start gap-2 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => abrir(p)}
                      aria-expanded={abierto === p.id_registro}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm font-medium">
                        {p.pdv ?? "Sin nombre"}
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-[var(--color-tinta-suave)]">
                        {p.direccion ?? "Sin dirección"}
                      </span>
                      <span className="cifras mt-1 block text-xs text-[var(--color-tinta-suave)]">
                        {p.id_pdv} · {p.usuario} · cc {p.ccuser} · ruta {p.ruta ?? "—"} ·{" "}
                        {p.ciclo || "sin ciclo"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => eliminar(p)}
                      aria-label={`Eliminar ${p.pdv ?? p.id_pdv}`}
                      className="shrink-0 rounded-[4px] border border-[var(--color-linea)] p-2 text-[var(--color-tinta-suave)] hover:border-[var(--color-alerta)] hover:text-[var(--color-alerta)]"
                    >
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </div>

                  {abierto === p.id_registro && (
                    <div className="border-t border-[var(--color-linea)] bg-[#f7f9f7] px-4 py-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        {CAMPOS.map(({ clave, etiqueta, tipo }) => (
                          <div key={clave}>
                            <label
                              htmlFor={`${clave}-${p.id_registro}`}
                              className="campo-etiqueta"
                            >
                              {etiqueta}
                            </label>
                            <input
                              id={`${clave}-${p.id_registro}`}
                              type={tipo ?? "text"}
                              step={tipo === "number" ? 1 : undefined}
                              value={(borrador[clave] as string | number | null) ?? ""}
                              onChange={(e) =>
                                setBorrador((b) => ({ ...b, [clave]: e.target.value }))
                              }
                              className="campo"
                            />
                          </div>
                        ))}
                      </div>

                      <p className="mt-3 text-xs text-[var(--color-tinta-suave)]">
                        El ID del PDV y el ciclo no se editan: son la llave con la
                        que la próxima carga reconoce el punto.
                      </p>

                      <div className="mt-4 flex gap-2">
                        <button
                          type="button"
                          onClick={() => guardar(p.id_registro)}
                          disabled={guardando}
                          className="flex items-center gap-2 rounded-[4px] bg-[var(--color-tinta)] px-4 py-2 text-sm font-medium text-white disabled:opacity-45"
                        >
                          {guardando && (
                            <Loader2 size={15} className="animate-spin" aria-hidden />
                          )}
                          Guardar cambios
                        </button>
                        <button
                          type="button"
                          onClick={() => setAbierto(null)}
                          className="rounded-[4px] border border-[var(--color-linea)] px-4 py-2 text-sm"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ---------------------------------------------------- eliminar en bloque */}
      <section className="rounded-[4px] border border-[var(--color-alerta)] bg-[var(--color-papel)] p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-alerta)]">
          <TriangleAlert size={16} aria-hidden />
          Eliminar cartera
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
          Borra puntos de forma definitiva. No hay papelera: si te equivocas, hay
          que volver a cargar el Excel.
        </p>

        {ciclos && ciclos.length > 0 && (
          <table className="mt-4 w-full text-left text-[13px]">
            <thead className="text-xs text-[var(--color-tinta-suave)]">
              <tr className="border-b border-[var(--color-linea)]">
                <th className="py-1.5 font-medium">Ciclo</th>
                <th className="py-1.5 text-right font-medium">Puntos</th>
                <th className="py-1.5 text-right font-medium">Vendedores</th>
              </tr>
            </thead>
            <tbody className="cifras">
              {ciclos.map((c) => (
                <tr key={c.ciclo} className="border-b border-[var(--color-linea)]">
                  <td className="py-1.5">{c.ciclo || "sin ciclo"}</td>
                  <td className="py-1.5 text-right">{c.puntos}</td>
                  <td className="py-1.5 text-right">{c.vendedores}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-1.5">Total</td>
                <td className="py-1.5 text-right">{total}</td>
                <td />
              </tr>
            </tbody>
          </table>
        )}

        <div className="mt-5 space-y-3">
          <div>
            <label htmlFor="ciclo-purga" className="campo-etiqueta">
              Qué eliminar
            </label>
            <select
              id="ciclo-purga"
              value={cicloElegido}
              onChange={(e) => {
                setCicloElegido(e.target.value);
                setConfirmacion("");
              }}
              className="campo"
            >
              <option value="">Toda la cartera</option>
              {ciclos?.map((c) => (
                <option key={c.ciclo} value={c.ciclo}>
                  Solo {c.ciclo || "sin ciclo"} ({c.puntos} puntos)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="confirmar-purga" className="campo-etiqueta">
              Escribe <span className="cifras font-semibold">{fraseEsperada}</span> para
              confirmar
            </label>
            <input
              id="confirmar-purga"
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value)}
              className="campo"
              autoComplete="off"
            />
          </div>

          <button
            type="button"
            onClick={purgar}
            disabled={purgando || confirmacion.trim() !== fraseEsperada}
            className="flex items-center gap-2 rounded-[4px] bg-[var(--color-alerta)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {purgando && <Loader2 size={15} className="animate-spin" aria-hidden />}
            Eliminar definitivamente
          </button>
        </div>
      </section>
    </div>
  );
}
