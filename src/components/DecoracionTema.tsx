import type { IdTema } from "@/lib/temas";

/**
 * Adornos de temporada. Es un componente de servidor a propósito: son marcas
 * estáticas y animación en CSS, así que no hay por qué mandar JavaScript al
 * navegador para esto.
 *
 * Reglas que siguen todos los temas:
 *  - La capa es fixed con pointer-events: none, así que nunca bloquea un toque.
 *  - En celular se dibujan menos partículas y los adornos van más pequeños.
 *  - Nada lleva texto: es decoración, y va con aria-hidden.
 */

/** Aleatorio reproducible: el servidor y el navegador tienen que pintar igual. */
function azar(i: number, semilla: number): number {
  const x = Math.sin(i * 12.9898 + semilla * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const TOTAL_PARTICULAS = 26;
/** De aquí en adelante solo se ven de sm hacia arriba. */
const TOPE_MOVIL = 14;

type Particula = {
  i: number;
  izquierda: number;
  retraso: number;
  duracion: number;
  tamano: number;
  opacidad: number;
  deriva: number;
  soloEscritorio: boolean;
};

function particulas(): Particula[] {
  return Array.from({ length: TOTAL_PARTICULAS }, (_, i) => ({
    i,
    izquierda: azar(i, 1) * 100,
    retraso: -azar(i, 2) * 16,
    duracion: 9 + azar(i, 3) * 11,
    tamano: 6 + azar(i, 4) * 8,
    opacidad: 0.35 + azar(i, 5) * 0.45,
    deriva: (azar(i, 6) - 0.5) * 120,
    soloEscritorio: i >= TOPE_MOVIL,
  }));
}

function Nieve() {
  return (
    <>
      {particulas().map((p) => (
        <span
          key={p.i}
          className={`tema-cae rounded-full bg-white ${p.soloEscritorio ? "hidden sm:block" : ""}`}
          style={{
            left: `${p.izquierda}%`,
            width: p.tamano * 0.7,
            height: p.tamano * 0.7,
            opacity: p.opacidad,
            animationDuration: `${p.duracion}s`,
            animationDelay: `${p.retraso}s`,
            boxShadow: "0 0 6px rgba(255,255,255,0.9)",
            ["--deriva" as string]: `${p.deriva}px`,
          }}
        />
      ))}
    </>
  );
}

const COLORES_LUCES = ["#D1495B", "#2A9D5C", "#E0A800", "#1F6F8B"];

function TiraDeLuces() {
  return (
    <div className="absolute inset-x-0 top-0">
      <div className="h-px w-full bg-[#16242b]/25" style={{ marginTop: 6 }} />
      <div className="-mt-[7px] flex justify-between px-2 sm:px-6">
        {Array.from({ length: 22 }, (_, i) => (
          <span
            key={i}
            className={`tema-titila block h-2.5 w-2.5 rounded-full ${i >= 12 ? "hidden sm:block" : ""}`}
            style={{
              background: COLORES_LUCES[i % COLORES_LUCES.length],
              boxShadow: `0 0 8px ${COLORES_LUCES[i % COLORES_LUCES.length]}`,
              animationDelay: `${i * 0.18}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Confeti() {
  const colores = ["#D1495B", "#2A9D5C", "#E0A800", "#1F6F8B", "#8E5BB5"];
  return (
    <>
      {particulas().map((p) => (
        <span
          key={p.i}
          className={`tema-cae ${p.soloEscritorio ? "hidden sm:block" : ""}`}
          style={{
            left: `${p.izquierda}%`,
            width: p.tamano * 0.55,
            height: p.tamano,
            background: colores[p.i % colores.length],
            opacity: p.opacidad + 0.2,
            borderRadius: 2,
            animationDuration: `${p.duracion}s`,
            animationDelay: `${p.retraso}s`,
            ["--deriva" as string]: `${p.deriva}px`,
            ["--giro" as string]: `${720 + p.i * 40}deg`,
          }}
        />
      ))}
    </>
  );
}

function Corazones() {
  return (
    <>
      {particulas().map((p) => (
        <span
          key={p.i}
          className={`tema-sube ${p.soloEscritorio ? "hidden sm:block" : ""}`}
          style={{
            left: `${p.izquierda}%`,
            animationDuration: `${p.duracion + 6}s`,
            animationDelay: `${p.retraso}s`,
            ["--deriva" as string]: `${p.deriva}px`,
            ["--opacidad" as string]: `${p.opacidad}`,
          }}
        >
          <svg width={p.tamano + 8} height={p.tamano + 8} viewBox="0 0 24 24" fill="#D1495B">
            <path d="M12 21s-7.5-4.7-9.5-9.2C1 8.4 2.7 5 6.1 5c2 0 3.3 1.1 3.9 2.1C10.6 6.1 11.9 5 13.9 5c3.4 0 5.1 3.4 3.6 6.8C19.5 16.3 12 21 12 21z" />
          </svg>
        </span>
      ))}
    </>
  );
}

function LucesQueSuben() {
  return (
    <>
      {particulas().map((p) => (
        <span
          key={p.i}
          className={`tema-sube rounded-full ${p.soloEscritorio ? "hidden sm:block" : ""}`}
          style={{
            left: `${p.izquierda}%`,
            width: p.tamano * 0.6,
            height: p.tamano * 0.6,
            background: "#f7d67a",
            boxShadow: "0 0 12px #f0b429",
            animationDuration: `${p.duracion + 8}s`,
            animationDelay: `${p.retraso}s`,
            ["--deriva" as string]: `${p.deriva * 0.5}px`,
            ["--opacidad" as string]: `${p.opacidad}`,
          }}
        />
      ))}
    </>
  );
}

function Farolito({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 92" className={className}>
      <path d="M30 4 v10" stroke="#8a6b3a" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="14" y="14" width="32" height="6" rx="3" fill="#8a6b3a" />
      <path
        d="M17 20 h26 l5 44 a 18 18 0 0 1 -36 0 z"
        fill="#f6d488"
        stroke="#c98a12"
        strokeWidth="2"
      />
      <ellipse cx="30" cy="56" rx="7" ry="10" fill="#f0b429" opacity="0.85" />
      <rect x="20" y="78" width="20" height="5" rx="2.5" fill="#8a6b3a" />
    </svg>
  );
}

function Telarana({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} fill="none">
      <g fill="none" stroke="#4d6067" strokeWidth="1.6" strokeLinecap="round" opacity="0.65">
        <path d="M0 0 L120 0 M0 0 L112 46 M0 0 L86 86 M0 0 L46 112 M0 0 L0 120" />
        <path d="M30 0 Q 27 27 0 30" />
        <path d="M58 0 Q 51 51 0 58" />
        <path d="M86 0 Q 75 75 0 86" />
        <path d="M114 0 Q 99 99 0 114" />
      </g>
    </svg>
  );
}

function Arana({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 190" className={className}>
      {/* El hilo sale del borde de arriba, así el balanceo se ve natural. */}
      <line x1="40" y1="0" x2="40" y2="108" stroke="#4d6067" strokeWidth="1.5" />
      <g stroke="#1b1b1b" strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M26 128 C 10 120, 6 138, 2 150" />
        <path d="M26 140 C 10 140, 6 156, 4 168" />
        <path d="M54 128 C 70 120, 74 138, 78 150" />
        <path d="M54 140 C 70 140, 74 156, 76 168" />
      </g>
      <ellipse cx="40" cy="126" rx="12" ry="10" fill="#1b1b1b" />
      <ellipse cx="40" cy="146" rx="17" ry="20" fill="#1b1b1b" />
      <circle cx="35" cy="123" r="3.2" fill="#f0b429" />
      <circle cx="45" cy="123" r="3.2" fill="#f0b429" />
    </svg>
  );
}

function Calabaza({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 104" className={className}>
      <path d="M60 22 c 2 -10 8 -14 16 -15 -3 8 -6 12 -12 16 z" fill="#2A9D5C" />
      <path d="M58 24 v -12" stroke="#5d4326" strokeWidth="6" strokeLinecap="round" />
      <ellipse cx="60" cy="62" rx="52" ry="40" fill="#E07B00" />
      <g fill="none" stroke="#c96a00" strokeWidth="3" strokeLinecap="round" opacity="0.7">
        <path d="M36 30 C 26 44, 26 80, 36 94" />
        <path d="M84 30 C 94 44, 94 80, 84 94" />
      </g>
      <g fill="#3a2410">
        <path d="M38 50 l16 10 -16 6 z" />
        <path d="M82 50 l-16 10 16 6 z" />
        <path d="M38 76 q 22 16 44 0 q -8 4 -10 -3 q -6 6 -12 0 q -6 6 -12 0 q -2 7 -10 3 z" />
      </g>
    </svg>
  );
}

export default function DecoracionTema({ tema }: { tema: IdTema }) {
  return (
    <div className="tema-capa" aria-hidden="true">
      {tema === "navidad" && (
        <>
          <TiraDeLuces />
          <Nieve />
        </>
      )}

      {tema === "anio-nuevo" && <Confeti />}

      {tema === "amor-amistad" && <Corazones />}

      {tema === "velitas" && (
        <>
          <LucesQueSuben />
          <Farolito className="absolute bottom-[calc(var(--alto-pie)+8px)] left-2 h-16 w-auto opacity-90 sm:bottom-[calc(var(--alto-pie)+16px)] sm:left-6 sm:h-24" />
          <Farolito className="absolute bottom-[calc(var(--alto-pie)+8px)] right-2 h-14 w-auto opacity-80 sm:bottom-[calc(var(--alto-pie)+16px)] sm:right-6 sm:h-20" />
        </>
      )}

      {tema === "halloween" && (
        <>
          <Telarana className="absolute left-0 top-0 h-20 w-20 sm:h-32 sm:w-32" />
          <Telarana className="absolute right-0 top-0 h-20 w-20 -scale-x-100 sm:h-32 sm:w-32" />
          <Arana className="tema-cuelga absolute left-[62%] top-0 h-28 w-auto sm:left-[72%] sm:h-40" />
          <Calabaza className="absolute bottom-[calc(var(--alto-pie)+6px)] left-2 h-14 w-auto sm:bottom-[calc(var(--alto-pie)+14px)] sm:left-6 sm:h-20" />
        </>
      )}
    </div>
  );
}
