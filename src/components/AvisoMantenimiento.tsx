import Link from "next/link";
import { Clock, RefreshCw } from "lucide-react";
import { textoHasta, type EstadoMantenimiento } from "@/lib/mantenimiento";

/**
 * Ilustración: una grúa colgando un marcador sobre el mapa de la cartera.
 * Va en SVG dentro del componente para que no dependa de ningún archivo ni
 * de una conexión que el consultor puede no tener en la calle.
 */
function Ilustracion({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 560 300"
      className={className}
      role="img"
      aria-label="Una grúa colocando un marcador sobre un mapa"
    >
      {/* piso */}
      <line
        x1="24"
        y1="252"
        x2="536"
        y2="252"
        stroke="var(--color-linea)"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* mapa */}
      <rect
        x="48"
        y="84"
        width="268"
        height="150"
        rx="6"
        fill="var(--color-papel)"
        stroke="var(--color-linea)"
        strokeWidth="2"
      />
      <path d="M48 106 h268" stroke="var(--color-linea)" strokeWidth="2" />
      <rect x="62" y="91" width="54" height="8" rx="4" fill="#dfe4e0" />
      <rect x="124" y="91" width="28" height="8" rx="4" fill="#eef1ee" />

      {/* calles */}
      <path
        d="M48 176 h268 M152 106 v128 M232 106 v128"
        stroke="#eef1ee"
        strokeWidth="6"
      />

      {/* ruta */}
      <path
        d="M86 208 C 122 182, 132 206, 168 178 S 238 152, 282 164"
        fill="none"
        stroke="#c6cfc9"
        strokeWidth="2.5"
        strokeDasharray="6 6"
        strokeLinecap="round"
      />

      {/* marcadores ya colocados */}
      <g>
        <path
          d="M86 208 c -5.5 -7 -9 -11 -9 -15.5 a 9 9 0 1 1 18 0 c 0 4.5 -3.5 8.5 -9 15.5 z"
          fill="#1F6F8B"
        />
        <circle cx="86" cy="192.5" r="3.4" fill="#ffffff" />
      </g>
      <g>
        <path
          d="M168 178 c -5.5 -7 -9 -11 -9 -15.5 a 9 9 0 1 1 18 0 c 0 4.5 -3.5 8.5 -9 15.5 z"
          fill="#2A9D5C"
        />
        <circle cx="168" cy="162.5" r="3.4" fill="#ffffff" />
      </g>
      <g>
        <path
          d="M282 164 c -5.5 -7 -9 -11 -9 -15.5 a 9 9 0 1 1 18 0 c 0 4.5 -3.5 8.5 -9 15.5 z"
          fill="#D1495B"
        />
        <circle cx="282" cy="148.5" r="3.4" fill="#ffffff" />
      </g>

      {/* hueco donde va el marcador que trae la grúa */}
      <ellipse cx="216" cy="128" rx="13" ry="4.5" fill="#e6eae7" />

      {/* grúa: pluma de celosía, sujeta por un tirante al camión */}
      <path
        d="M496 198 L340.6 125.8"
        stroke="#bcc6c0"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <g stroke="#a9b4ad" strokeWidth="3" strokeLinecap="round" fill="none">
        <path d="M439.6 190.6 L219.6 46.6" />
        <path d="M432.4 201.4 L212.4 57.4" />
      </g>
      <g stroke="#c2ccc6" strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M439.6 190.6 L404.9 183.4 M404.9 183.4 L384.6 154.6 M384.6 154.6 L349.9 147.4 M349.9 147.4 L329.6 118.6 M329.6 118.6 L294.9 111.4 M294.9 111.4 L274.6 82.6 M274.6 82.6 L239.9 75.4 M239.9 75.4 L219.6 46.6" />
      </g>
      <circle cx="436" cy="196" r="7" fill="#e8eae6" stroke="#a9b4ad" strokeWidth="2.5" />
      <circle cx="216" cy="52" r="5" fill="#e8eae6" stroke="#a9b4ad" strokeWidth="2.5" />

      {/* cable y marcador colgando */}
      <line
        x1="216"
        y1="56"
        x2="216"
        y2="86"
        stroke="var(--color-tinta-suave)"
        strokeWidth="2"
      />
      <path
        d="M210 86 h12 v6 h-12 z"
        fill="var(--color-tinta-suave)"
      />
      <g>
        <path
          d="M216 126 c -8 -10.5 -13 -16 -13 -22.5 a 13 13 0 1 1 26 0 c 0 6.5 -5 12 -13 22.5 z"
          fill="var(--color-ambar)"
        />
        <circle cx="216" cy="103.5" r="5" fill="#ffffff" />
      </g>

      {/* camión */}
      <rect
        x="380"
        y="196"
        width="120"
        height="32"
        rx="5"
        fill="#e8eae6"
        stroke="var(--color-linea)"
        strokeWidth="2"
      />
      <rect
        x="344"
        y="200"
        width="38"
        height="28"
        rx="4"
        fill="var(--color-papel)"
        stroke="var(--color-linea)"
        strokeWidth="2"
      />
      <rect x="351" y="206" width="17" height="11" rx="2" fill="#dbe2e5" />
      <rect x="404" y="204" width="16" height="12" rx="2" fill="var(--color-ambar)" />
      <rect x="452" y="204" width="16" height="12" rx="2" fill="var(--color-ambar)" />

      <g fill="var(--color-marcador)">
        <circle cx="376" cy="236" r="14" />
        <circle cx="474" cy="236" r="14" />
      </g>
      <g fill="#edefec">
        <circle cx="376" cy="236" r="5.5" />
        <circle cx="474" cy="236" r="5.5" />
      </g>
    </svg>
  );
}

export default function AvisoMantenimiento({
  estado,
}: {
  estado: EstadoMantenimiento;
}) {
  const hasta = textoHasta(estado.hasta);

  return (
    <main className="fondo-acceso flex w-full flex-1 flex-col justify-center px-5 py-6 sm:py-8">
      <div className="mx-auto w-full max-w-lg">
        <div className="tarjeta-acceso rounded-[14px] border border-[var(--color-linea)] bg-[var(--color-papel)] px-6 pb-6 pt-4 text-center">
          {/* La ilustración se recorta en alto con vh para que la tarjeta quepa
              en pantalla y el pie de página no quede debajo del doblez. */}
          <Ilustracion className="mx-auto h-auto w-full max-w-[400px] max-h-[30vh]" />

          <h1 className="mt-1 text-[24px] leading-[1.15] font-semibold tracking-tight text-[var(--color-tinta)] sm:text-[26px]">
            Estamos actualizando la cartera
          </h1>

          <p className="mx-auto mt-2.5 max-w-[42ch] text-[14px] leading-relaxed text-[var(--color-tinta-suave)] sm:text-[15px]">
            {estado.mensaje}
          </p>

          {hasta && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#fdf4e3] px-3 py-1.5 text-[13px] font-medium text-[#7a5410]">
              <Clock size={14} aria-hidden />
              Volvemos el {hasta}
            </p>
          )}

          {/* Enlace normal, no <Link>: recarga de verdad y vuelve a preguntarle
              al servidor si la ventana sigue abierta. */}
          <a
            href="/"
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-[6px] bg-[#1F6F8B] px-4 py-3 text-[15px] font-medium text-white transition-colors hover:bg-[#195b73]"
          >
            <RefreshCw size={16} aria-hidden />
            Volver a intentar
          </a>

          <p className="mx-auto mt-4 max-w-[42ch] text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
            Tu cartera no se pierde. Apenas terminemos, entras con tu usuario y tu
            contraseña Livetrade como siempre. Si es urgente, comunícate con
            Soporte BackOffice.
          </p>
        </div>

        <p className="mt-5 flex items-center justify-center gap-3 text-center text-[13px] text-[var(--color-tinta-suave)]">
          <Link href="/backoffice" className="underline underline-offset-2">
            Acceso BackOffice
          </Link>
          <span aria-hidden>·</span>
          <Link href="/admin" className="underline underline-offset-2">
            Acceso administrador
          </Link>
        </p>
      </div>
    </main>
  );
}
