"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, TriangleAlert } from "lucide-react";
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

/** El código de barras del pie de la credencial: siempre el mismo dibujo. */
const BARRAS = (() => {
  const barras: { x: number; ancho: number }[] = [];
  let semilla = 7;
  const azar = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
  for (let x = 0; x < 200; ) {
    const ancho = 1 + Math.floor(azar() * 4);
    if (azar() > 0.35) barras.push({ x, ancho });
    x += ancho + 1;
  }
  return barras;
})();

type Props = {
  /** expirada, perfil o inactiva. */
  motivo?: string;
  /** Se reutiliza en /admin y en /backoffice: solo cambian el texto. */
  titulo?: string;
  descripcion?: string;
  /** El nombre junto al logo. */
  rotulo?: string;
};

export default function LoginAdmin({
  motivo,
  titulo = "Administración",
  descripcion = "Administración de la cartera del equipo.",
  rotulo = "Cartera LiveTrade",
}: Props) {
  const router = useRouter();
  const cinta = useRef<HTMLDivElement>(null);
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [cargando, setCargando] = useState(false);
  /** Entró bien: la cinta de la credencial se ensancha hasta cubrir la pantalla. */
  const [cortina, setCortina] = useState<React.CSSProperties | null>(null);
  const [error, setError] = useState<string | null>(
    motivo ? (MOTIVOS[motivo] ?? null) : null
  );

  const esBackOffice = titulo === "BackOffice";
  const entrando = cortina !== null;

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
        setCortina(desdeLaCinta(cinta.current));
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
    <main
      className="credencial-pantalla"
      style={{ fontFamily: "var(--font-archivo, var(--font-jakarta, var(--font-plex)))" }}
    >
      <AplicarModoPanel />

      {cortina && (
        <div
          aria-hidden
          className="cortina-cubre tarjeta-heroe pointer-events-none fixed inset-0 z-[120] rounded-none shadow-none"
          style={cortina}
        />
      )}

      <section className="credencial-texto">
        <span className="credencial-marca">
          <i aria-hidden>LT</i>
          {rotulo}
        </span>
        <h1>Tu credencial para {esBackOffice ? "el BackOffice" : "el panel"}.</h1>
        <p>{descripcion} Cada ingreso queda registrado con el usuario que entró.</p>
        {/* <a> y no <Link>: la consulta se carga de nuevo y queda sin modo oscuro. */}
        <a href="/" className="credencial-volver">
          Volver a la consulta
        </a>
      </section>

      <section className="credencial-colgante">
        <div ref={cinta} aria-hidden className="credencial-cinta" />
        <div aria-hidden className="credencial-gancho" />

        <div className="credencial-carne">
          <div aria-hidden className="credencial-ranura" />
          <div className="credencial-franja">
            <b>Credencial de acceso</b>
            <span>{esBackOffice ? "BackOffice de soporte" : `Panel de ${titulo.toLowerCase()}`}</span>
          </div>
          <div aria-hidden className="credencial-foto">
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
            </svg>
          </div>

          <div className="credencial-datos">
            <h2>¿Quién entra?</h2>
            <p>Usa tu usuario y tu clave del panel.</p>

            <form onSubmit={entrar}>
              <div className="credencial-campo">
                <label htmlFor="usuario">Usuario</label>
                <input
                  id="usuario"
                  required
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="jsrodriguez"
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                />
              </div>

              <div className="credencial-campo">
                <label htmlFor="clave">Clave</label>
                <div className="credencial-clave">
                  <input
                    id="clave"
                    type={verClave ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={clave}
                    onChange={(e) => setClave(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setVerClave((v) => !v)}
                    aria-label={verClave ? "Ocultar la clave" : "Ver la clave"}
                    title={verClave ? "Ocultar la clave" : "Ver la clave"}
                    className="credencial-ojo"
                  >
                    {verClave ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
                  </button>
                </div>
              </div>

              {error && (
                <p role="alert" className="credencial-aviso">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={cargando || entrando}
                className="credencial-entrar"
              >
                {(cargando || entrando) && <Loader2 size={16} className="animate-spin" aria-hidden />}
                Entrar
              </button>
            </form>
          </div>

          <div aria-hidden className="credencial-barras">
            <svg viewBox="0 0 200 34" preserveAspectRatio="none">
              {BARRAS.map((b) => (
                <rect key={b.x} x={b.x} y={0} width={b.ancho} height={34} />
              ))}
            </svg>
            <small>
              Válida solo
              <br />
              con usuario y clave
            </small>
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * Dónde empieza la cortina: en la cinta de la credencial, que se ensancha
 * hacia los lados y hacia abajo. Sin cinta a la vista, sube desde abajo.
 */
function desdeLaCinta(cinta: HTMLElement | null): React.CSSProperties {
  const ancho = window.innerWidth;
  const alto = window.innerHeight;
  const r = cinta?.getBoundingClientRect();
  if (!r || r.bottom <= 0 || r.width === 0) {
    return { ["--cortina-arriba" as string]: `${alto}px`, ["--cortina-desde" as string]: "0px" };
  }
  const px = (n: number) => `${Math.round(Math.max(0, n))}px`;
  return {
    ["--cortina-arriba" as string]: px(r.top),
    ["--cortina-desde" as string]: px(ancho - r.right),
    ["--cortina-abajo" as string]: px(alto - r.bottom),
    ["--cortina-izq" as string]: px(r.left),
  };
}
