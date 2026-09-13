"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, TriangleAlert } from "lucide-react";

export default function LoginAdmin({ expirada }: { expirada?: boolean }) {
  const router = useRouter();
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(
    expirada ? "Tu sesión expiró. Vuelve a entrar." : null
  );

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, clave }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json.error ?? "No pudimos validar el acceso.");
        return;
      }
      router.refresh();
    } catch {
      setError("No hay conexión con el servidor.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5">
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-tinta)]">
        Administración
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-tinta-suave)]">
        Esta sección carga la plantilla maestra y reemplaza la cartera de todo el
        equipo.
      </p>

      <form
        onSubmit={entrar}
        className="mt-6 rounded-[4px] border border-[var(--color-linea)] bg-[var(--color-papel)] p-5"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="usuario" className="campo-etiqueta">
              Usuario
            </label>
            <input
              id="usuario"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="jsrodriguez"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              className="campo"
            />
          </div>

          <div>
            <label htmlFor="clave" className="campo-etiqueta">
              Clave
            </label>
            <input
              id="clave"
              type="password"
              required
              autoComplete="current-password"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              className="campo"
            />
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-[4px] bg-[#f8ecea] px-3 py-2.5 text-[13px] text-[var(--color-alerta)]"
          >
            <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={cargando || !usuario || !clave}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-[4px] bg-[var(--color-tinta)] px-4 py-3 text-[15px] font-medium text-white disabled:opacity-45"
        >
          {cargando && <Loader2 size={16} className="animate-spin" aria-hidden />}
          Entrar
        </button>
      </form>

      <p className="mt-6 text-center text-[13px]">
        <Link
          href="/"
          className="text-[var(--color-tinta-suave)] underline underline-offset-2"
        >
          Volver a la consulta
        </Link>
      </p>
    </main>
  );
}
