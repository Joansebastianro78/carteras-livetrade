"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import IlustracionRastreo from "@/components/IlustracionRastreo";

type Props = {
  expirada?: boolean;
  /** Se reutiliza en /admin y en /backoffice: solo cambian el texto. */
  titulo?: string;
  descripcion?: string;
  /** Rótulo pequeño del panel oscuro. */
  rotulo?: string;
};

export default function LoginAdmin({
  expirada,
  titulo = "Administración",
  descripcion = "Esta sección carga la plantilla maestra y reemplaza la cartera de todo el equipo.",
  rotulo = "Cartera LiveTrade",
}: Props) {
  const router = useRouter();
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [verClave, setVerClave] = useState(false);
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

      // Un perfil BackOffice no tiene nada que hacer en /admin: se le lleva
      // directo a lo suyo en vez de esperar a que el middleware lo desvíe.
      if (json.rol === "backoffice") {
        router.replace("/backoffice");
        router.refresh();
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
    <main className="fondo-acceso flex-1 px-4 py-6 md:py-10">
      <div className="tarjeta-acceso mx-auto w-full max-w-3xl overflow-hidden rounded-[14px] border border-[var(--color-linea)] bg-[var(--color-papel)] md:grid md:grid-cols-[1fr_1fr]">
        <aside className="panel-acceso hidden flex-col justify-between p-7 text-white md:flex">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#9dc0cc]">
              {rotulo}
            </p>
            <h2 className="mt-3 text-[22px] leading-[1.2] font-semibold tracking-tight">
              {titulo}
            </h2>
          </div>

          <IlustracionRastreo className="my-4 h-auto max-h-[30vh] w-full max-w-[240px] self-center" />

          <p className="flex items-start gap-3 text-[13px] leading-snug text-[#d7e3e7]">
            <span
              aria-hidden
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-[#9fd3e2]"
            >
              <ShieldCheck size={15} />
            </span>
            Acceso restringido. Cada ingreso queda registrado con el usuario que
            entró.
          </p>
        </aside>

        <div className="p-6 sm:p-8">
          <h1 className="text-[26px] leading-[1.15] font-semibold tracking-tight text-[var(--color-tinta)]">
            {titulo}
          </h1>
          <p className="mt-2.5 text-[14px] leading-relaxed text-[var(--color-tinta-suave)]">
            {descripcion}
          </p>

          <form onSubmit={entrar} className="mt-6">
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
                <div className="relative">
                  <input
                    id="clave"
                    type={verClave ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={clave}
                    onChange={(e) => setClave(e.target.value)}
                    className="campo pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setVerClave((v) => !v)}
                    aria-label={verClave ? "Ocultar la clave" : "Ver la clave"}
                    title={verClave ? "Ocultar la clave" : "Ver la clave"}
                    className="absolute inset-y-0 right-0 grid w-11 place-items-center text-[var(--color-tinta-suave)] hover:text-[var(--color-tinta)]"
                  >
                    {verClave ? (
                      <EyeOff size={17} aria-hidden />
                    ) : (
                      <Eye size={17} aria-hidden />
                    )}
                  </button>
                </div>
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
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-[6px] bg-[#1F6F8B] px-4 py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-[#195b73] disabled:bg-[#9fb3bb] disabled:hover:bg-[#9fb3bb]"
            >
              {cargando && <Loader2 size={16} className="animate-spin" aria-hidden />}
              Entrar
            </button>
          </form>
        </div>
      </div>

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
