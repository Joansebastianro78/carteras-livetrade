"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import IlustracionRastreo from "@/components/IlustracionRastreo";
import { AplicarModoPanel } from "@/components/ModoPanel";
import { LLAVE_ENTRADA } from "@/lib/entrada";

/** Lo que dura la cortina índigo al entrar (cortina-cubre en globals.css). */
const DURACION_CORTINA_MS = 480;

/** Por qué se cerró la sesión: llega en ?sesion= desde el middleware. */
const MOTIVOS: Record<string, string> = {
  expirada: "Tu sesión expiró. Vuelve a entrar.",
  perfil: "Tu perfil cambió. Vuelve a entrar para seguir con el nuevo.",
  inactiva: "Tu usuario fue desactivado. Si crees que es un error, habla con un administrador.",
};

type Props = {
  /** expirada, perfil o inactiva. */
  motivo?: string;
  /** Se reutiliza en /admin y en /backoffice: solo cambian el texto. */
  titulo?: string;
  descripcion?: string;
  /** Rótulo pequeño del panel oscuro. */
  rotulo?: string;
};

export default function LoginAdmin({
  motivo,
  titulo = "Administración",
  descripcion = "Esta sección carga la plantilla maestra y reemplaza la cartera de todo el equipo.",
  rotulo = "Cartera LiveTrade",
}: Props) {
  const router = useRouter();
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [cargando, setCargando] = useState(false);
  /** Entró bien: la cortina índigo cubre la pantalla antes de pasar al panel. */
  const [entrando, setEntrando] = useState(false);
  const [error, setError] = useState<string | null>(
    motivo ? (MOTIVOS[motivo] ?? null) : null
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

      // La cortina cubre la pantalla y el panel la retira al abrirse.
      const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      try {
        if (!quieto) sessionStorage.setItem(LLAVE_ENTRADA, "1");
      } catch {
        // sin almacenamiento: se entra sin cortina
      }
      if (!quieto) {
        setEntrando(true);
        await new Promise((listo) => setTimeout(listo, DURACION_CORTINA_MS));
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
    <main className="flex flex-1 flex-col bg-[var(--color-base)] md:flex-row">
      <AplicarModoPanel />

      {entrando && (
        <div
          aria-hidden
          className="cortina-cubre tarjeta-heroe pointer-events-none fixed inset-0 z-[120] rounded-none shadow-none"
          style={{ ["--cortina-desde" as string]: "56%" }}
        />
      )}

      {/* Panel índigo: en pantallas anchas ocupa la izquierda; en el celular, una franja arriba. */}
      <aside className="tarjeta-heroe relative isolate flex flex-col overflow-hidden rounded-none px-6 py-6 shadow-none md:w-[44%] md:max-w-[620px] md:justify-between md:px-12 md:py-12">
        <span aria-hidden className="absolute -top-24 -right-24 -z-10 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <span aria-hidden className="absolute -bottom-28 -left-16 -z-10 h-72 w-72 rounded-full bg-white/10 blur-3xl" />

        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-10 w-10 place-items-center rounded-[12px] bg-white/15 text-[14px] font-bold tracking-wide ring-1 ring-white/25"
          >
            LT
          </span>
          <span>
            <span className="block text-[15px] font-semibold">{rotulo}</span>
            <span className="block text-[12px] opacity-75">{titulo}</span>
          </span>
        </div>

        <div className="hidden md:block">
          <p className="max-w-[420px] text-[34px] leading-[1.12] font-semibold tracking-[-0.02em]">
            Toda la cartera del equipo, en un solo lugar.
          </p>
          <p className="mt-3 max-w-[400px] text-[14px] leading-relaxed opacity-80">
            Cargue, auditorías, tableros y el asistente, con los permisos de tu perfil.
          </p>
        </div>

        <IlustracionRastreo className="my-6 hidden h-auto max-h-[34vh] w-full max-w-[260px] self-center md:block" />

        <p className="hidden items-start gap-3 text-[13px] leading-snug opacity-85 md:flex">
          <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/15">
            <ShieldCheck size={15} />
          </span>
          Acceso restringido. Cada ingreso queda registrado con el usuario que entró.
        </p>
      </aside>

      <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <p className="text-[14px] font-medium text-[var(--color-acento-tinta)]">
            Bienvenido de nuevo <span aria-hidden>👋</span>
          </p>
          <h1 className="mt-1.5 text-[30px] leading-[1.1] font-semibold tracking-[-0.02em] text-[var(--color-tinta)]">
            {titulo}
          </h1>
          <p className="mt-2.5 text-[14px] leading-relaxed text-[var(--color-tinta-suave)]">{descripcion}</p>

          <form onSubmit={entrar} className="mt-7">
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
                    {verClave ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
                  </button>
                </div>
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-[12px] bg-[var(--color-alerta-fondo)] px-3 py-2.5 text-[13px] text-[var(--color-alerta)]"
              >
                <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={cargando || entrando || !usuario || !clave}
              className="boton boton-primario mt-6 min-h-[48px] w-full text-[15px]"
            >
              {(cargando || entrando) && <Loader2 size={16} className="animate-spin" aria-hidden />}
              Entrar
            </button>
          </form>

          <p className="mt-6 text-center text-[13px]">
            {/* <a> y no <Link>: la consulta se carga de nuevo y queda sin modo oscuro. */}
            <a href="/" className="text-[var(--color-tinta-suave)] underline underline-offset-2">
              Volver a la consulta
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
