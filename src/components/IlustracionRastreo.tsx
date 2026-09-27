/**
 * Ilustración de los accesos: un celular con la cartera del día en el mapa,
 * la ruta trazada y el punto que se está rastreando.
 *
 * Va en SVG dentro del componente y no como imagen: el vendedor entra desde
 * la calle, muchas veces con señal mala, y esto no cuesta una descarga más.
 * Pensada sobre fondo oscuro (--color-tinta).
 */
export default function IlustracionRastreo({
  className = "",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 320 264"
      className={className}
      role="img"
      aria-label="Un celular mostrando los puntos de la cartera sobre un mapa"
    >
      {/* halo: blanco translúcido para que funcione sobre el degradado */}
      <circle cx="160" cy="132" r="112" fill="#ffffff" opacity="0.05" />
      <circle cx="160" cy="132" r="84" fill="#ffffff" opacity="0.07" />

      {/* celular */}
      <rect
        x="100"
        y="18"
        width="120"
        height="228"
        rx="18"
        fill="#ffffff"
        stroke="#0e1a1f"
        strokeWidth="2"
      />
      <rect x="142" y="26" width="36" height="6" rx="3" fill="#dfe6e1" />

      {/* pantalla */}
      <rect x="108" y="40" width="104" height="182" rx="8" fill="#eef2ef" />

      {/* calles */}
      <g stroke="#ffffff" strokeWidth="7" strokeLinecap="round">
        <path d="M108 92 h104" />
        <path d="M108 160 h104" />
        <path d="M140 40 v182" />
        <path d="M186 40 v182" />
      </g>
      <g stroke="#dde5df" strokeWidth="1.5">
        <path d="M108 92 h104" />
        <path d="M108 160 h104" />
      </g>

      {/* manzanas */}
      <g fill="#e4eae5">
        <rect x="114" y="52" width="18" height="30" rx="3" />
        <rect x="150" y="104" width="26" height="46" rx="3" />
        <rect x="194" y="172" width="14" height="38" rx="3" />
      </g>

      {/* ruta */}
      <path
        d="M126 200 C 126 176, 152 178, 156 152 S 186 118, 176 74"
        fill="none"
        stroke="#4d6067"
        strokeWidth="2.5"
        strokeDasharray="5 5"
        strokeLinecap="round"
      />

      {/* punto visitado */}
      <g>
        <path
          d="M126 200 c -4.6 -5.9 -7.6 -9.3 -7.6 -13.1 a 7.6 7.6 0 1 1 15.2 0 c 0 3.8 -3 7.2 -7.6 13.1 z"
          fill="#2A9D5C"
        />
        <circle cx="126" cy="186.8" r="2.9" fill="#ffffff" />
      </g>

      {/* punto siguiente */}
      <g>
        <path
          d="M176 74 c -4.6 -5.9 -7.6 -9.3 -7.6 -13.1 a 7.6 7.6 0 1 1 15.2 0 c 0 3.8 -3 7.2 -7.6 13.1 z"
          fill="#D1495B"
        />
        <circle cx="176" cy="60.8" r="2.9" fill="#ffffff" />
      </g>

      {/* punto que se está rastreando, con su pulso */}
      <circle cx="156" cy="152" r="21" fill="#c98a12" opacity="0.12" />
      <circle cx="156" cy="152" r="13" fill="#c98a12" opacity="0.2" />
      <circle cx="156" cy="152" r="6.5" fill="#c98a12" stroke="#ffffff" strokeWidth="2.5" />

      {/* fichas flotantes */}
      <g>
        <rect
          x="26"
          y="72"
          width="74"
          height="30"
          rx="8"
          fill="#ffffff"
          stroke="#0e1a1f"
          strokeWidth="1.5"
        />
        <circle cx="43" cy="87" r="8" fill="#1F6F8B" />
        <path
          d="M39.5 87 l2.5 2.5 l4.5 -5"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="57" y="81" width="32" height="5" rx="2.5" fill="#d9e0db" />
        <rect x="57" y="90" width="20" height="5" rx="2.5" fill="#e8ece9" />
      </g>

      <g>
        <rect
          x="222"
          y="158"
          width="74"
          height="30"
          rx="8"
          fill="#ffffff"
          stroke="#0e1a1f"
          strokeWidth="1.5"
        />
        <circle cx="239" cy="173" r="8" fill="#c98a12" />
        <path
          d="M239 169.2 v7.6 M235.2 173 h7.6"
          stroke="#ffffff"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <rect x="253" y="167" width="32" height="5" rx="2.5" fill="#d9e0db" />
        <rect x="253" y="176" width="24" height="5" rx="2.5" fill="#e8ece9" />
      </g>

      {/* chispas */}
      <g fill="#ffffff" opacity="0.16">
        <circle cx="62" cy="180" r="5" />
        <circle cx="250" cy="70" r="7" />
        <circle cx="86" cy="36" r="3.5" />
        <circle cx="264" cy="224" r="4" />
      </g>
    </svg>
  );
}
