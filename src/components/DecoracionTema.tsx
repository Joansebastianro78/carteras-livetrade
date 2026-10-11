import type { CSSProperties, ReactNode } from "react";
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

/**
 * Las partículas de un tema. `semilla` cambia dónde y cuándo sale cada una,
 * para que dos temas no caigan por los mismos sitios; con 0 son las de siempre.
 */
function particulas(semilla = 0, total = TOTAL_PARTICULAS, tope = TOPE_MOVIL): Particula[] {
  const s = semilla * 10;
  return Array.from({ length: total }, (_, i) => ({
    i,
    izquierda: azar(i, 1 + s) * 100,
    retraso: -azar(i, 2 + s) * 16,
    duracion: 9 + azar(i, 3 + s) * 11,
    tamano: 6 + azar(i, 4 + s) * 8,
    opacidad: 0.35 + azar(i, 5 + s) * 0.45,
    deriva: (azar(i, 6 + s) - 0.5) * 120,
    soloEscritorio: i >= tope,
  }));
}

/** Variables CSS en el style de React. */
function vars(valores: Record<string, string | number>): CSSProperties {
  return valores as unknown as CSSProperties;
}

const SOLO_ESCRITORIO = "hidden sm:block";

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

// =====================================================================
// Temas nuevos
// =====================================================================

/**
 * Guirnalda: un cordón en arcos a lo ancho de la parte de arriba, con algo
 * colgando de cada punto. Los arcos se estiran con la pantalla (el SVG va sin
 * proporción fija) y el cordón conserva su grosor.
 */
function Guirnalda({
  tramos,
  porTramo,
  caida,
  color,
  className = "",
  colgante,
}: {
  tramos: number;
  porTramo: number;
  caida: number;
  color: string;
  className?: string;
  colgante: (i: number) => ReactNode;
}) {
  const puntos: { i: number; x: number; y: number }[] = [];
  for (let k = 0; k < tramos; k++) {
    for (let j = 1; j <= porTramo; j++) {
      const t = j / (porTramo + 1);
      puntos.push({ i: puntos.length, x: ((k + t) / tramos) * 100, y: 3 + 4 * caida * t * (1 - t) });
    }
  }
  const arcos = Array.from(
    { length: tramos },
    (_, k) => `Q ${k * 100 + 50} ${3 + 2 * caida} ${(k + 1) * 100} 3`
  ).join(" ");

  return (
    <div className={`absolute inset-x-0 top-0 ${className}`}>
      <svg
        className="absolute inset-x-0 top-0 h-[60px] w-full"
        viewBox={`0 0 ${tramos * 100} 60`}
        preserveAspectRatio="none"
      >
        <path d={`M0 3 ${arcos}`} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      {puntos.map((p) => (
        <span key={p.i} className="absolute -translate-x-1/2" style={{ left: `${p.x}%`, top: p.y }}>
          {colgante(p.i)}
        </span>
      ))}
    </div>
  );
}

/** Lo que cuelga de una guirnalda se mece desde el punto donde está amarrado. */
function Colgando({ i, amplitud, children }: { i: number; amplitud: number; children: ReactNode }) {
  return (
    <span
      className="tema-cuelga block"
      style={vars({
        animationDuration: `${2.8 + azar(i, 51) * 1.6}s`,
        animationDelay: `${-azar(i, 52) * 4}s`,
        "--colgar": `${amplitud}deg`,
      })}
    >
      {children}
    </span>
  );
}

/** Algo que cae meciéndose de lado a lado, como un pétalo o una hoja. */
function CaenMeciendose({
  semilla,
  total,
  tope,
  lenta = 0,
  pieza,
}: {
  semilla: number;
  total?: number;
  tope?: number;
  /** Segundos de más en la caída. */
  lenta?: number;
  pieza: (p: Particula) => ReactNode;
}) {
  return (
    <>
      {particulas(semilla, total, tope).map((p) => (
        <span
          key={p.i}
          className={`tema-cae ${p.soloEscritorio ? SOLO_ESCRITORIO : ""}`}
          style={vars({
            left: `${p.izquierda}%`,
            opacity: Math.min(1, p.opacidad + 0.25),
            animationDuration: `${p.duracion + lenta}s`,
            animationDelay: `${p.retraso}s`,
            "--deriva": `${p.deriva * 0.6}px`,
            "--giro": `${(azar(p.i, 53 + semilla) - 0.5) * 360}deg`,
          })}
        >
          <span
            className="tema-vaiven block"
            style={vars({
              animationDuration: `${2.4 + azar(p.i, 54 + semilla) * 1.8}s`,
              animationDelay: `${-azar(p.i, 55 + semilla) * 3}s`,
              "--vaiven": `${12 + azar(p.i, 56 + semilla) * 22}px`,
            })}
          >
            {pieza(p)}
          </span>
        </span>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ Carnaval

const COLORES_CARNAVAL = ["#E63946", "#FFC300", "#2A9D5C", "#1F6FB8", "#8E5BB5", "#F77F00"];

function Serpentinas() {
  return (
    <>
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className={`tema-cuelga absolute top-0 ${i % 2 === 1 ? SOLO_ESCRITORIO : ""}`}
          style={vars({
            left: `${3 + i * 11.8}%`,
            animationDuration: `${3.4 + azar(i, 61) * 2}s`,
            animationDelay: `${-azar(i, 62) * 4}s`,
            "--colgar": "6deg",
          })}
        >
          <svg viewBox="0 0 26 150" className="block h-[70px] w-auto sm:h-[118px]">
            <path
              d={`M13 0 C 26 10, 0 20, 13 30 S 26 50, 13 60 S 0 80, 13 90 S 26 110, 13 120 S 0 ${135 + (i % 3) * 5}, 13 ${145 - (i % 2) * 20}`}
              fill="none"
              stroke={COLORES_CARNAVAL[i % COLORES_CARNAVAL.length]}
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
        </span>
      ))}
    </>
  );
}

function ConfetiRedondo() {
  return (
    <>
      {particulas(3).map((p) => (
        <span
          key={p.i}
          className={`tema-cae rounded-full ${p.soloEscritorio ? SOLO_ESCRITORIO : ""}`}
          style={vars({
            left: `${p.izquierda}%`,
            width: p.tamano * 0.75,
            height: p.tamano * 0.75,
            background: COLORES_CARNAVAL[p.i % COLORES_CARNAVAL.length],
            opacity: Math.min(1, p.opacidad + 0.3),
            animationDuration: `${p.duracion}s`,
            animationDelay: `${p.retraso}s`,
            "--deriva": `${p.deriva}px`,
          })}
        />
      ))}
    </>
  );
}

function Antifaz({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 -44 140 136" className={className}>
      {/* Plumas */}
      <path d="M30 26 C 18 8, 22 -18, 38 -38 C 42 -14, 40 8, 30 26 Z" fill="#E63946" />
      <path d="M36 26 C 32 4, 44 -16, 62 -28 C 58 -6, 50 12, 36 26 Z" fill="#2A9D5C" />
      <path d="M24 28 C 8 18, 2 -2, 10 -22 C 20 -6, 26 10, 24 28 Z" fill="#1F6FB8" />
      {/* Palito */}
      <path d="M116 58 L 136 90" stroke="#8a5a2b" strokeWidth="5" strokeLinecap="round" />
      {/* Antifaz */}
      <path
        d="M10 40 C 10 22, 40 16, 70 30 C 100 16, 130 22, 130 40 C 130 58, 108 66, 92 60 C 82 56, 76 50, 70 50 C 64 50, 58 56, 48 60 C 32 66, 10 58, 10 40 Z"
        fill="#F2B705"
        stroke="#a66d00"
        strokeWidth="2"
      />
      <path d="M30 38 C 36 30, 52 32, 57 40 C 50 47, 36 47, 30 38 Z" fill="#3a1d0a" />
      <path d="M110 38 C 104 30, 88 32, 83 40 C 90 47, 104 47, 110 38 Z" fill="#3a1d0a" />
      <g fill="#E63946">
        <circle cx="70" cy="40" r="3.5" />
        <circle cx="20" cy="44" r="2.5" />
        <circle cx="120" cy="44" r="2.5" />
      </g>
      <g fill="#1F6FB8">
        <circle cx="44" cy="54" r="2.5" />
        <circle cx="96" cy="54" r="2.5" />
      </g>
    </svg>
  );
}

// ------------------------------------------------------------------ San Valentín

const CORAZON = "M12 21.3C5.2 16.6 2 12.7 2 8.7 2 5.7 4.3 3.4 7.2 3.4c1.9 0 3.7 1.1 4.8 2.7 1.1-1.6 2.9-2.7 4.8-2.7 2.9 0 5.2 2.3 5.2 5.3 0 4-3.2 7.9-10 12.6z";

function CorazonColgante({ i, tamano }: { i: number; tamano: number }) {
  const colores = ["#D1495B", "#E76F8A", "#B5174B", "#F08BA6"];
  const hilo = 6 + (i % 3) * 7;
  return (
    <Colgando i={i} amplitud={9}>
      <svg width={tamano} height={tamano + hilo} viewBox={`0 0 24 ${24 + hilo}`}>
        <line x1="12" y1="0" x2="12" y2={hilo + 5} stroke="#a77c86" strokeWidth="1" />
        <path d={CORAZON} transform={`translate(0 ${hilo})`} fill={colores[i % colores.length]} />
      </svg>
    </Colgando>
  );
}

function GuirnaldaDeCorazones() {
  return (
    <>
      <Guirnalda
        className="sm:hidden"
        tramos={2}
        porTramo={3}
        caida={16}
        color="#b98a95"
        colgante={(i) => <CorazonColgante i={i} tamano={18} />}
      />
      <Guirnalda
        className={SOLO_ESCRITORIO}
        tramos={4}
        porTramo={4}
        caida={22}
        color="#b98a95"
        colgante={(i) => <CorazonColgante i={i} tamano={24} />}
      />
    </>
  );
}

// ------------------------------------------------------------------ Día de la Mujer

const COLORES_MUJER = ["#8E5BB5", "#B07CD8", "#6C3BAA", "#D3B3EE"];

function Petalo({ color, tamano }: { color: string; tamano: number }) {
  return (
    <svg width={tamano} height={tamano * 1.35} viewBox="0 0 16 22">
      <path d="M8 1 C 15 6, 14 17, 8 21 C 2 17, 1 6, 8 1 Z" fill={color} />
      <path d="M8 5 C 11 8, 11 14, 8 17" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

/** Florcita de cinco pétalos. */
function Flor({ x, y, r, color, centro = "#F2C14E" }: { x: number; y: number; r: number; color: string; centro?: string }) {
  return (
    <g>
      {Array.from({ length: 5 }, (_, k) => {
        const a = (k * 72 - 90) * (Math.PI / 180);
        return <circle key={k} cx={x + Math.cos(a) * r} cy={y + Math.sin(a) * r} r={r * 0.95} fill={color} />;
      })}
      <circle cx={x} cy={y} r={r * 0.6} fill={centro} />
    </g>
  );
}

function RamaFlorecida({ className = "" }: { className?: string }) {
  const flores: [number, number, number, string][] = [
    [128, 14, 5, "#B07CD8"],
    [104, 26, 6, "#8E5BB5"],
    [86, 40, 4.5, "#D3B3EE"],
    [64, 50, 5.5, "#B07CD8"],
    [44, 58, 4.5, "#8E5BB5"],
    [24, 63, 5, "#D3B3EE"],
    [112, 46, 4, "#D3B3EE"],
  ];
  return (
    <svg viewBox="0 0 160 90" className={className}>
      <path d="M160 4 C 130 12, 104 22, 80 40 C 64 52, 46 60, 18 64" fill="none" stroke="#6b4a3a" strokeWidth="3" strokeLinecap="round" />
      <path d="M118 22 C 116 32, 114 40, 112 46" fill="none" stroke="#6b4a3a" strokeWidth="2" strokeLinecap="round" />
      <path d="M92 33 C 88 26, 90 18, 96 12" fill="none" stroke="#6b4a3a" strokeWidth="2" strokeLinecap="round" />
      <path d="M96 12 C 101 10, 104 13, 102 17 C 99 19, 96 16, 96 12 Z" fill="#7fae6b" />
      <path d="M70 46 C 72 54, 68 60, 60 62 C 60 55, 64 49, 70 46 Z" fill="#7fae6b" />
      {flores.map(([x, y, r, c], k) => (
        <Flor key={k} x={x} y={y} r={r} color={c} />
      ))}
    </svg>
  );
}

// ------------------------------------------------------------------ Día de la Tierra

function Hoja({ color, tamano }: { color: string; tamano: number }) {
  return (
    <svg width={tamano} height={tamano * 1.4} viewBox="0 0 20 28">
      <path d="M10 1 C 18 7, 18 20, 10 27 C 2 20, 2 7, 10 1 Z" fill={color} />
      <path d="M10 4 V 25" stroke="#1f5130" strokeOpacity="0.45" strokeWidth="1.2" />
    </svg>
  );
}

function Brote({ variante }: { variante: number }) {
  return (
    <svg viewBox="0 0 40 80" className="h-full w-auto" preserveAspectRatio="xMidYMax meet">
      <path d="M20 80 C 19 62, 22 42, 20 22" fill="none" stroke="#3f8f4f" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M20 58 C 8 56, 3 47, 5 40 C 13 42, 19 49, 20 58 Z" fill="#5cb85c" />
      <path d="M20 44 C 32 42, 37 33, 35 26 C 27 28, 21 35, 20 44 Z" fill="#4aa463" />
      {variante === 0 && <path d="M20 24 C 14 16, 16 7, 20 2 C 24 7, 26 16, 20 24 Z" fill="#7cc576" />}
      {variante === 1 && <Flor x={20} y={16} r={4.5} color="#F2C14E" centro="#E07B00" />}
      {variante === 2 && <Flor x={20} y={16} r={4.5} color="#ffffff" centro="#F2C14E" />}
    </svg>
  );
}

function Brotes() {
  return (
    <div className="absolute inset-x-0" style={{ bottom: "var(--alto-pie)" }}>
      {Array.from({ length: 12 }, (_, i) => (
        <span
          key={i}
          className={`tema-crece absolute bottom-0 ${i % 2 === 1 ? SOLO_ESCRITORIO : ""}`}
          style={{
            left: `${2 + i * 8.4 + azar(i, 71) * 3}%`,
            height: `${40 + azar(i, 72) * 40}px`,
            animationDelay: `${azar(i, 73) * 1.2}s`,
          }}
        >
          <span
            className="tema-mece block h-full"
            style={{ animationDuration: `${2.6 + azar(i, 74) * 1.4}s`, animationDelay: `${-azar(i, 75) * 3}s` }}
          >
            <Brote variante={i % 3} />
          </span>
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Día del Niño

function Burbujas() {
  return (
    <>
      {particulas(5, 20, 10).map((p) => {
        const tamano = 14 + azar(p.i, 81) * 30;
        return (
          <span
            key={p.i}
            className={`tema-sube ${p.soloEscritorio ? SOLO_ESCRITORIO : ""}`}
            style={vars({
              left: `${p.izquierda}%`,
              animationDuration: `${p.duracion + 5}s`,
              animationDelay: `${p.retraso}s`,
              "--deriva": `${p.deriva * 0.6}px`,
              "--opacidad": "0.95",
            })}
          >
            <span
              className="tema-tiembla block rounded-full"
              style={{
                width: tamano,
                height: tamano,
                border: "1px solid rgba(110, 165, 205, 0.55)",
                background:
                  "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95) 0 9%, rgba(255,255,255,0) 22%), radial-gradient(circle at 50% 50%, rgba(255,255,255,0.05) 55%, rgba(150,210,255,0.5) 72%, rgba(255,160,220,0.55) 86%, rgba(255,255,255,0.75) 100%)",
                animationDuration: `${1.4 + azar(p.i, 82)}s`,
              }}
            />
          </span>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------ Día de la Madre

const COLORES_MARIPOSAS: [string, string][] = [
  ["#F08BA6", "#C2185B"],
  ["#F6A57A", "#D2622A"],
  ["#B79AE8", "#6C3BAA"],
  ["#7FC8E8", "#1F6F8B"],
];

function Mariposa({ ala, borde }: { ala: string; borde: string }) {
  return (
    <svg viewBox="0 0 40 32" className="tema-aletea block h-7 w-auto sm:h-9">
      <g fill={ala} stroke={borde} strokeWidth="1.2">
        <path d="M20 15 C 14 2, 2 0, 3 9 C 4 15, 12 17, 20 16 Z" />
        <path d="M20 17 C 12 18, 5 24, 9 29 C 13 32, 18 25, 20 18 Z" />
        <path d="M20 15 C 26 2, 38 0, 37 9 C 36 15, 28 17, 20 16 Z" />
        <path d="M20 17 C 28 18, 35 24, 31 29 C 27 32, 22 25, 20 18 Z" />
      </g>
      <ellipse cx="20" cy="17" rx="1.6" ry="7" fill="#3a2a2a" />
      <path d="M19.5 10 C 18 6, 16 4, 15 3 M20.5 10 C 22 6, 24 4, 25 3" stroke="#3a2a2a" strokeWidth="0.8" fill="none" />
    </svg>
  );
}

function Mariposas() {
  return (
    <>
      {Array.from({ length: 7 }, (_, i) => {
        const alReves = i % 2 === 1;
        const [ala, borde] = COLORES_MARIPOSAS[i % COLORES_MARIPOSAS.length];
        return (
          <span
            key={i}
            className={`tema-cruza ${i >= 4 ? SOLO_ESCRITORIO : ""}`}
            style={{
              top: `${10 + azar(i, 91) * 62}%`,
              animationDuration: `${20 + azar(i, 92) * 14}s`,
              animationDelay: `${-azar(i, 93) * 30}s`,
              animationDirection: alReves ? "reverse" : "normal",
            }}
          >
            <span
              className="tema-flota block"
              style={vars({
                animationDuration: `${2 + azar(i, 94) * 1.4}s`,
                "--flote": `${-10 - azar(i, 95) * 18}px`,
              })}
            >
              <span className="block" style={{ transform: `rotate(${alReves ? -12 : 12}deg)` }}>
                <Mariposa ala={ala} borde={borde} />
              </span>
            </span>
          </span>
        );
      })}
    </>
  );
}

function Tulipanes({ className = "" }: { className?: string }) {
  const tulipan = (x: number, alto: number, giro: number, color: string, oscuro: string) => (
    <g transform={`rotate(${giro} ${x} 118)`}>
      <path d={`M${x} 118 C ${x - 1} ${118 - alto * 0.4}, ${x + 1} ${118 - alto * 0.7}, ${x} ${118 - alto}`} stroke="#3f8f4f" strokeWidth="3" fill="none" />
      <path d={`M${x} ${118 - alto * 0.25} C ${x - 14} ${118 - alto * 0.35}, ${x - 18} ${118 - alto * 0.55}, ${x - 15} ${118 - alto * 0.7} C ${x - 6} ${118 - alto * 0.6}, ${x - 1} ${118 - alto * 0.45}, ${x} ${118 - alto * 0.25} Z`} fill="#5cb85c" />
      <path
        d={`M${x - 11} ${118 - alto - 20} C ${x - 11} ${118 - alto - 6}, ${x - 6} ${118 - alto + 2}, ${x} ${118 - alto + 2} C ${x + 6} ${118 - alto + 2}, ${x + 11} ${118 - alto - 6}, ${x + 11} ${118 - alto - 20} L ${x + 6} ${118 - alto - 14} L ${x} ${118 - alto - 24} L ${x - 6} ${118 - alto - 14} Z`}
        fill={color}
        stroke={oscuro}
        strokeWidth="1.2"
      />
    </g>
  );
  return (
    <svg viewBox="0 0 110 120" className={className}>
      {tulipan(36, 58, -12, "#F08BA6", "#C2185B")}
      {tulipan(74, 52, 12, "#F6A57A", "#D2622A")}
      {tulipan(55, 72, 0, "#E8546C", "#A3203A")}
    </svg>
  );
}

// ------------------------------------------------------------------ Día del Padre

function Corbata({ i }: { i: number }) {
  const estilos = [
    { fondo: "#1F4E79", raya: "#9cc0e6" },
    { fondo: "#7A1F2B", raya: "#e8b04a" },
    { fondo: "#1F6F5C", raya: "#d7efe4" },
    { fondo: "#B5651D", raya: "#3a2410" },
    { fondo: "#3B3F58", raya: "#e2e5ef" },
  ];
  const e = estilos[i % estilos.length];
  // La hoja es un trapecio de y=12 a y=46: el borde izquierdo va de x=8 a x=4.
  const izq = (y: number) => 8 - (4 * (y - 12)) / 34;
  const der = (y: number) => 12 + (4 * (y - 12)) / 34;
  const rayas = [20, 28, 36, 44].map((y) => `M${izq(y)} ${y} L${der(y - 4)} ${y - 4}`).join(" ");
  return (
    <Colgando i={i} amplitud={10}>
      <svg viewBox="0 0 20 60" className="block h-9 w-auto sm:h-12">
        <line x1="10" y1="0" x2="10" y2="5" stroke="#6b7c83" strokeWidth="1" />
        <path d="M7 5 H13 L12 12 H8 Z" fill={e.fondo} />
        <path d="M8 12 H12 L16 46 L10 57 L4 46 Z" fill={e.fondo} />
        {i % 2 === 0 ? (
          <path d={rayas} stroke={e.raya} strokeWidth="1.6" />
        ) : (
          <g fill={e.raya}>
            <circle cx="10" cy="22" r="1.1" />
            <circle cx="8" cy="31" r="1.1" />
            <circle cx="12" cy="31" r="1.1" />
            <circle cx="10" cy="40" r="1.1" />
          </g>
        )}
      </svg>
    </Colgando>
  );
}

function GuirnaldaDeCorbatas() {
  return (
    <>
      <Guirnalda className="sm:hidden" tramos={2} porTramo={3} caida={12} color="#8b9ba0" colgante={(i) => <Corbata i={i} />} />
      <Guirnalda className={SOLO_ESCRITORIO} tramos={4} porTramo={3} caida={18} color="#8b9ba0" colgante={(i) => <Corbata i={i} />} />
    </>
  );
}

// ------------------------------------------------------------------ Independencia

const BANDERA = ["#FCD116", "#003893", "#CE1126"];

function Banderin({ i }: { i: number }) {
  return (
    <Colgando i={i} amplitud={4}>
      <svg viewBox="0 0 24 30" className="block h-5 w-auto sm:h-7">
        <path d="M1 0 H23 L12 29 Z" fill={BANDERA[i % 3]} stroke="rgba(0,0,0,0.15)" strokeWidth="0.8" />
      </svg>
    </Colgando>
  );
}

function FuegosArtificiales() {
  // Azul más claro que el de la bandera: el oscuro no se ve de noche.
  const colores = ["#FCD116", "#4F8BEA", "#E5303F", "#FFFFFF"];
  const fuegos = [
    { x: 9, y: 22, r: 46, movil: true },
    { x: 91, y: 17, r: 52, movil: true },
    { x: 20, y: 42, r: 40, movil: false },
    { x: 82, y: 44, r: 46, movil: false },
    { x: 6, y: 64, r: 36, movil: false },
    { x: 95, y: 70, r: 40, movil: false },
  ];
  return (
    <>
      {fuegos.map((f, k) => (
        <span key={k} className={`absolute ${f.movil ? "" : SOLO_ESCRITORIO}`} style={{ left: `${f.x}%`, top: `${f.y}%` }}>
          {Array.from({ length: 12 }, (_, j) => (
            <span
              key={j}
              className="tema-chispa"
              style={vars({
                "--angulo": `${j * 30}deg`,
                "--radio": `${f.r}px`,
                background: colores[(j + k) % colores.length],
                boxShadow: `0 0 6px ${colores[(j + k) % colores.length]}`,
                animationDuration: `${4.6 + k * 0.7}s`,
                animationDelay: `${-k * 1.3}s`,
              })}
            />
          ))}
        </span>
      ))}
    </>
  );
}

function FiestasPatrias() {
  return (
    <>
      <Guirnalda className="sm:hidden" tramos={2} porTramo={5} caida={12} color="#6b7c83" colgante={(i) => <Banderin i={i} />} />
      <Guirnalda className={SOLO_ESCRITORIO} tramos={4} porTramo={7} caida={18} color="#6b7c83" colgante={(i) => <Banderin i={i} />} />
      <FuegosArtificiales />
    </>
  );
}

// ------------------------------------------------------------------ Cometas

function Cometa({ colores }: { colores: [string, string, string, string] }) {
  return (
    <svg viewBox="0 0 70 172" className="block h-full w-auto">
      <path d="M35 2 L66 34 L35 34 Z" fill={colores[0]} />
      <path d="M35 2 L4 34 L35 34 Z" fill={colores[1]} />
      <path d="M4 34 L35 92 L35 34 Z" fill={colores[2]} />
      <path d="M66 34 L35 92 L35 34 Z" fill={colores[3]} />
      <path d="M35 2 V92 M4 34 H66" stroke="#5d4326" strokeWidth="1.4" />
      {/* La cola se mece aparte, desde la punta de abajo. */}
      <g className="tema-mece" style={vars({ transformOrigin: "35px 92px", "--mecer": "9deg", animationDuration: "1.8s" })}>
        <path d="M35 92 C 26 108, 46 120, 36 136 S 30 158, 40 170" fill="none" stroke="#5d4326" strokeWidth="1.2" />
        {[
          [33, 110, colores[0]],
          [39, 128, colores[2]],
          [33, 146, colores[1]],
          [38, 162, colores[3]],
        ].map(([x, y, c], k) => (
          <path
            key={k}
            d={`M${x} ${y} l-7 -4 v8 z M${x} ${y} l7 -4 v8 z`}
            fill={c as string}
          />
        ))}
      </g>
    </svg>
  );
}

/** Nubes a los lados que se pasean un poco, sin cruzar por encima del contenido. */
function Nubes() {
  return (
    <>
      {[
        { izquierda: "1%", top: 30, ancho: 120, dur: 14, paseo: 40 },
        { izquierda: "91%", top: 20, ancho: 140, dur: 18, paseo: -46 },
        { izquierda: "6%", top: 58, ancho: 96, dur: 16, paseo: 34 },
        { izquierda: "93%", top: 62, ancho: 110, dur: 20, paseo: -38 },
      ].map((n, k) => (
        <span
          key={k}
          className={`tema-pasea absolute ${SOLO_ESCRITORIO}`}
          style={vars({
            left: n.izquierda,
            top: `${n.top}%`,
            animationDuration: `${n.dur}s`,
            animationDelay: `${-k * 3}s`,
            "--paseo": `${n.paseo}px`,
          })}
        >
          <svg viewBox="0 0 120 60" style={{ width: n.ancho }} className="block h-auto">
            <path
              d="M30 50 C 14 50, 8 38, 18 31 C 16 18, 32 12, 40 20 C 46 6, 70 6, 74 22 C 86 16, 100 24, 96 34 C 110 36, 110 50, 96 50 Z"
              fill="#ffffff"
              fillOpacity="0.85"
              stroke="#c9dbe5"
              strokeWidth="1.5"
            />
          </svg>
        </span>
      ))}
    </>
  );
}

function Cometas() {
  // A los lados, donde no tapan el contenido; en el celular, pequeñas en las esquinas.
  const cometas: { donde: string; alto: string; colores: [string, string, string, string] }[] = [
    { donde: "left-[1%] top-[1%] sm:left-[3%] sm:top-[6%]", alto: "h-[62px] sm:h-[150px]", colores: ["#E63946", "#FFC300", "#1F6FB8", "#2A9D5C"] },
    // En pantallas grandes, a media altura del borde derecho: arriba taparía la
    // barra y los botones del panel.
    { donde: "right-[1%] top-[0.5%] sm:right-[0.5%] sm:top-[40%]", alto: "h-[56px] sm:h-[116px]", colores: ["#8E5BB5", "#F77F00", "#2A9D8F", "#E9C46A"] },
    { donde: "hidden sm:block left-[10%] top-[38%]", alto: "h-[104px]", colores: ["#1F6FB8", "#E63946", "#FFC300", "#8E5BB5"] },
  ];
  return (
    <>
      <Nubes />
      {cometas.map((c, k) => (
        <span key={k} className={`absolute ${c.donde}`}>
          <span
            className="tema-flota block"
            style={vars({ animationDuration: `${3.2 + k * 0.7}s`, "--flote": "-12px" })}
          >
            <span
              className={`tema-mece block ${c.alto}`}
              style={vars({ "--origen": "50% 20%", "--mecer": "6deg", animationDuration: `${4 + k * 0.9}s` })}
            >
              <Cometa colores={c.colores} />
            </span>
          </span>
        </span>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ Café

function GranosDeCafe() {
  return (
    <>
      {particulas(7, 16, 8).map((p) => (
        <span
          key={p.i}
          className={`tema-cae ${p.soloEscritorio ? SOLO_ESCRITORIO : ""}`}
          style={vars({
            left: `${p.izquierda}%`,
            opacity: Math.min(1, p.opacidad + 0.35),
            animationDuration: `${p.duracion + 6}s`,
            animationDelay: `${p.retraso}s`,
            "--deriva": `${p.deriva * 0.5}px`,
            "--giro": `${(azar(p.i, 101) - 0.5) * 540}deg`,
          })}
        >
          <svg width={p.tamano + 4} height={(p.tamano + 4) * 1.3} viewBox="0 0 20 26">
            <ellipse cx="10" cy="13" rx="8" ry="11" fill="#6b3e26" />
            <path d="M10 3 C 6 9, 14 17, 10 23" stroke="#3e2213" strokeWidth="1.6" fill="none" />
          </svg>
        </span>
      ))}
    </>
  );
}

function TazaDeCafe({ className = "" }: { className?: string }) {
  return (
    <span className={`absolute ${className}`}>
      {/* El vapor sale de la taza y se deshace. */}
      <span className="absolute bottom-[62%] left-[22%] flex w-[44%] justify-between">
        {[0, 1, 2].map((k) => (
          <svg
            key={k}
            viewBox="0 0 12 44"
            className="tema-humo block h-8 w-auto sm:h-11"
            style={{ animationDelay: `${-k * 1.1}s`, animationDuration: `${3 + k * 0.4}s` }}
          >
            <path d="M6 42 C 0 32, 12 26, 6 16 S 3 4, 8 1" fill="none" stroke="#a89888" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        ))}
      </span>
      <svg viewBox="0 0 120 100" className="block h-full w-auto">
        <ellipse cx="60" cy="90" rx="50" ry="8" fill="#e9dfd5" stroke="#c9b8a6" strokeWidth="2" />
        <path d="M90 50 C 108 50, 108 74, 86 74" fill="none" stroke="#c9b8a6" strokeWidth="7" strokeLinecap="round" />
        <path d="M22 42 H90 C 90 66, 80 86, 56 86 C 32 86, 22 66, 22 42 Z" fill="#f7f1ea" stroke="#c9b8a6" strokeWidth="2" />
        <path d="M25 56 H87" stroke="#c0623b" strokeWidth="4" />
        <ellipse cx="56" cy="42" rx="34" ry="6" fill="#6b3e26" />
      </svg>
    </span>
  );
}

// ------------------------------------------------------------------ Fútbol

/** Un balón cualquiera: pentágono al centro, cinco radios y cinco parches en el borde. */
function Balon({ className = "" }: { className?: string }) {
  const c = 20;
  const punto = (grados: number, radio: number) => {
    const a = (grados - 90) * (Math.PI / 180);
    return [c + Math.cos(a) * radio, c + Math.sin(a) * radio].map((n) => n.toFixed(2)).join(" ");
  };
  const centro = [0, 72, 144, 216, 288].map((g) => punto(g, 7.4)).join(" L ");
  const radios = [0, 72, 144, 216, 288].map((g) => `M ${punto(g, 7.4)} L ${punto(g, 12.6)}`).join(" ");
  const parches = [36, 108, 180, 252, 324]
    .map((g) => `M ${punto(g - 20, 18.4)} L ${punto(g - 11, 13)} L ${punto(g + 11, 13)} L ${punto(g + 20, 18.4)} A 18.4 18.4 0 0 0 ${punto(g - 20, 18.4)} Z`)
    .join(" ");
  return (
    <svg viewBox="0 0 40 40" className={className}>
      <circle cx="20" cy="20" r="18.4" fill="#ffffff" stroke="#1b1b1b" strokeWidth="1.5" />
      <path d={`M ${centro} Z`} fill="#1b1b1b" />
      <path d={radios} stroke="#1b1b1b" strokeWidth="1.3" />
      <path d={parches} fill="#1b1b1b" />
    </svg>
  );
}

function Futbol() {
  const balones = [
    { dur: 15, retraso: -2, rebote: 64, salto: 1.05, movil: true },
    { dur: 21, retraso: -11, rebote: 44, salto: 0.85, movil: true },
    { dur: 27, retraso: -19, rebote: 86, salto: 1.3, movil: false },
  ];
  return (
    <>
      {/* Franja con las proporciones de la bandera: mitad amarillo, un cuarto azul y un cuarto rojo. */}
      <div className="absolute inset-x-0 top-0 flex h-[5px]">
        <span className="h-full w-1/2" style={{ background: BANDERA[0] }} />
        <span className="h-full w-1/4" style={{ background: BANDERA[1] }} />
        <span className="h-full w-1/4" style={{ background: BANDERA[2] }} />
      </div>
      {balones.map((b, k) => (
        <span
          key={k}
          className={`tema-cruza ${b.movil ? "" : SOLO_ESCRITORIO}`}
          style={{ top: "auto", bottom: "calc(var(--alto-pie) + 2px)", animationDuration: `${b.dur}s`, animationDelay: `${b.retraso}s` }}
        >
          <span className="tema-rebota block" style={vars({ animationDuration: `${b.salto}s`, "--rebote": `${-b.rebote}px` })}>
            <span className="tema-gira block" style={{ animationDuration: `${b.salto * 1.7}s` }}>
              <Balon className="block h-7 w-7 sm:h-9 sm:w-9" />
            </span>
          </span>
        </span>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ Celebración

const COLORES_GLOBOS = ["#E63946", "#F4A261", "#2A9D8F", "#457B9D", "#8E5BB5", "#E9C46A"];

function Globos() {
  return (
    <>
      {particulas(9, 14, 7).map((p) => {
        const color = COLORES_GLOBOS[p.i % COLORES_GLOBOS.length];
        const alto = 54 + azar(p.i, 111) * 30;
        return (
          <span
            key={p.i}
            className={`tema-sube ${p.soloEscritorio ? SOLO_ESCRITORIO : ""}`}
            style={vars({
              left: `${p.izquierda}%`,
              animationDuration: `${p.duracion + 11}s`,
              animationDelay: `${p.retraso * 1.4}s`,
              "--deriva": `${p.deriva * 0.4}px`,
              "--opacidad": "0.92",
            })}
          >
            <span
              className="tema-mece block"
              style={vars({ "--origen": "50% 100%", "--mecer": "5deg", animationDuration: `${2.8 + azar(p.i, 112) * 1.6}s` })}
            >
              <svg viewBox="0 0 40 96" style={{ height: alto }} className="block w-auto">
                <path d="M20 2 C 31 2, 38 11, 38 22 C 38 35, 28 46, 20 48 C 12 46, 2 35, 2 22 C 2 11, 9 2, 20 2 Z" fill={color} />
                <ellipse cx="13" cy="15" rx="3" ry="6.5" fill="#ffffff" fillOpacity="0.45" transform="rotate(-20 13 15)" />
                <path d="M17 48 L23 48 L20 53 Z" fill={color} />
                <path d="M20 53 C 16 62, 24 70, 20 80 S 18 92, 21 96" fill="none" stroke="#9aa3a8" strokeWidth="1.2" />
              </svg>
            </span>
          </span>
        );
      })}
    </>
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

      {tema === "carnaval" && (
        <>
          <Serpentinas />
          <ConfetiRedondo />
          <Antifaz className="absolute bottom-[calc(var(--alto-pie)+8px)] left-2 h-16 w-auto -rotate-12 sm:bottom-[calc(var(--alto-pie)+16px)] sm:left-6 sm:h-24" />
        </>
      )}

      {tema === "san-valentin" && <GuirnaldaDeCorazones />}

      {tema === "mujer" && (
        <>
          <CaenMeciendose
            semilla={2}
            pieza={(p) => <Petalo color={COLORES_MUJER[p.i % COLORES_MUJER.length]} tamano={p.tamano + 4} />}
          />
          <RamaFlorecida className="absolute right-0 top-0 h-16 w-auto sm:h-24" />
        </>
      )}

      {tema === "tierra" && (
        <>
          <Brotes />
          <CaenMeciendose
            semilla={4}
            total={12}
            tope={6}
            lenta={4}
            pieza={(p) => <Hoja color={["#5cb85c", "#3f8f4f", "#8cc63f"][p.i % 3]} tamano={p.tamano + 6} />}
          />
        </>
      )}

      {tema === "nino" && <Burbujas />}

      {tema === "madre" && (
        <>
          <Mariposas />
          <Tulipanes className="absolute bottom-[calc(var(--alto-pie)+4px)] left-1 h-16 w-auto sm:bottom-[calc(var(--alto-pie)+10px)] sm:left-5 sm:h-28" />
          <Tulipanes className="absolute bottom-[calc(var(--alto-pie)+4px)] right-1 h-14 w-auto -scale-x-100 sm:bottom-[calc(var(--alto-pie)+10px)] sm:right-5 sm:h-24" />
        </>
      )}

      {tema === "padre" && <GuirnaldaDeCorbatas />}

      {tema === "independencia" && <FiestasPatrias />}

      {tema === "cometas" && <Cometas />}

      {tema === "cafe" && (
        <>
          <GranosDeCafe />
          <TazaDeCafe className="bottom-[calc(var(--alto-pie)+6px)] left-2 h-16 sm:bottom-[calc(var(--alto-pie)+14px)] sm:left-6 sm:h-24" />
        </>
      )}

      {tema === "futbol" && <Futbol />}

      {tema === "celebracion" && <Globos />}
    </div>
  );
}
