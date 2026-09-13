"use client";

import { useEffect, useState } from "react";
import { Loader2, UserPlus } from "lucide-react";

type Admin = {
  id: number;
  usuario: string;
  nombre: string | null;
  activo: boolean;
  ultimo_login: string | null;
  created_at: string;
};

const LARGO_MINIMO = 10;

export default function AdminUsuarios() {
  const [lista, setLista] = useState<Admin[] | null>(null);
  const [yo, setYo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "mal"; texto: string } | null>(null);

  const [usuario, setUsuario] = useState("");
  const [nombre, setNombre] = useState("");
  const [clave, setClave] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const res = await fetch("/api/admin/usuarios");
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setLista(json.usuarios ?? []);
      setYo(json.yo ?? null);
    } else {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo leer la lista." });
    }
  }

  const yaExiste = lista?.some((a) => a.usuario === usuario.trim().toLowerCase());

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setAviso(null);

    const res = await fetch("/api/admin/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, clave, nombre }),
    });
    const json = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo guardar." });
      return;
    }

    setAviso({
      tipo: "ok",
      texto: yaExiste
        ? `Se cambió la clave de ${json.usuario}.`
        : `Se creó ${json.usuario}. Entrégale la clave por un canal seguro: no se puede volver a consultar.`,
    });
    setUsuario("");
    setNombre("");
    setClave("");
    cargar();
  }

  async function alternar(a: Admin) {
    setAviso(null);
    const res = await fetch("/api/admin/usuarios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: a.usuario, activo: !a.activo }),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo actualizar." });
      return;
    }
    cargar();
  }

  function fecha(iso: string | null) {
    if (!iso) return "nunca";
    return new Date(iso).toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-sm font-semibold">Administradores</h2>
        <p className="mt-1 text-[13px] text-[var(--color-tinta-suave)]">
          Quien aparezca aquí puede cargar, editar y borrar la cartera completa.
        </p>

        {aviso && (
          <p
            role="status"
            className={`mt-3 rounded-[4px] px-3 py-2.5 text-[13px] leading-snug ${
              aviso.tipo === "ok"
                ? "bg-[#e7f2ec] text-[var(--color-exito)]"
                : "bg-[#f8ecea] text-[var(--color-alerta)]"
            }`}
          >
            {aviso.texto}
          </p>
        )}

        {lista === null ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-[var(--color-tinta-suave)]">
            <Loader2 size={15} className="animate-spin" aria-hidden />
            Cargando…
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--color-linea)] rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)]">
            {lista.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 px-4 py-3 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {a.nombre ?? a.usuario}
                    {a.usuario === yo && (
                      <span className="ml-2 text-xs font-normal text-[var(--color-tinta-suave)]">
                        tu sesión
                      </span>
                    )}
                  </span>
                  <span className="cifras mt-0.5 block truncate text-xs text-[var(--color-tinta-suave)]">
                    {a.usuario} · último ingreso {fecha(a.ultimo_login)}
                  </span>
                </span>

                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                    a.activo
                      ? "bg-[#e7f2ec] text-[var(--color-exito)]"
                      : "bg-[#eceeeb] text-[var(--color-tinta-suave)]"
                  }`}
                >
                  {a.activo ? "activo" : "inactivo"}
                </span>

                <button
                  type="button"
                  onClick={() => alternar(a)}
                  disabled={a.usuario === yo && a.activo}
                  className="shrink-0 rounded-[4px] border border-[var(--color-linea)] px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  {a.activo ? "Desactivar" : "Reactivar"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold">
          {yaExiste ? "Cambiar la clave" : "Crear un administrador"}
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
          Si escribes un usuario que ya existe, se le reemplaza la clave. Es la
          única forma de recuperarla: la clave se guarda cifrada y nadie, ni tú,
          puede volver a verla.
        </p>

        <form
          onSubmit={crear}
          className="mt-4 rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)] p-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="nuevo-usuario" className="campo-etiqueta">
                Usuario
              </label>
              <input
                id="nuevo-usuario"
                required
                autoCapitalize="none"
                spellCheck={false}
                placeholder="jsrodriguez"
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                className="campo"
              />
            </div>

            <div>
              <label htmlFor="nuevo-nombre" className="campo-etiqueta">
                Nombre
              </label>
              <input
                id="nuevo-nombre"
                placeholder="Juan Sebastián Rodríguez"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="campo"
              />
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="nueva-clave" className="campo-etiqueta">
              Clave
            </label>
            <input
              id="nueva-clave"
              type="password"
              required
              autoComplete="new-password"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              className="campo"
            />
            <p
              className={`mt-1.5 text-xs ${
                clave && clave.length < LARGO_MINIMO
                  ? "text-[var(--color-alerta)]"
                  : "text-[var(--color-tinta-suave)]"
              }`}
            >
              Mínimo {LARGO_MINIMO} caracteres.
            </p>
          </div>

          {yaExiste && (
            <p className="mt-3 rounded-[4px] bg-[#fdf4e3] px-3 py-2.5 text-[13px] text-[#7a5410]">
              Ese usuario ya existe. Al guardar, su clave actual deja de servir.
            </p>
          )}

          <button
            type="submit"
            disabled={guardando || !usuario || clave.length < LARGO_MINIMO}
            className="mt-5 flex items-center gap-2 rounded-[4px] bg-[var(--color-tinta)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-45"
          >
            {guardando ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <UserPlus size={15} aria-hidden />
            )}
            {yaExiste ? "Cambiar la clave" : "Crear administrador"}
          </button>
        </form>
      </section>
    </div>
  );
}
