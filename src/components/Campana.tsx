"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, ClipboardCheck, FileSpreadsheet, Loader2, MapPin, UserX, Wrench } from "lucide-react";
import type { IdModulo } from "@/lib/permisos";
import { EVENTO_RESUMEN_AUDITORIA, leerResumenAuditoria } from "@/lib/resumenAuditoria";
import { cifra } from "./ConsultaAthena";

/**
 * La campana del encabezado: lo que conviene revisar, sin tener que ir al
 * Inicio. El punto rojo sale con lo que ya se sabe sin consultar nada (la
 * consulta en mantenimiento y los hallazgos por revisar de la última
 * auditoría vista en este navegador); al abrirla se cuenta lo de la cartera.
 */

type Aviso = { id: string; Icono: typeof Bell; titulo: string; detalle: string; ir: string | null; tono: "alerta" | "aviso" | "neutro" };

type ResumenCartera = {
  general: { sin_ubicacion: number; libres: number | null };
  ultimaCarga: { archivo: string; filas_error: number } | null;
};

const TONO = {
  alerta: "bg-[var(--color-alerta-fondo)] text-[var(--color-alerta)]",
  aviso: "bg-[var(--color-aviso-fondo)] text-[var(--color-aviso-tinta)]",
  neutro: "bg-[var(--color-acento-suave)] text-[var(--color-acento-tinta)]",
};

export default function Campana({
  enMantenimiento,
  puede,
}: {
  enMantenimiento: boolean;
  puede: (m: IdModulo) => boolean;
}) {
  const [abierta, setAbierta] = useState(false);
  const [porRevisar, setPorRevisar] = useState(0);
  const [cartera, setCartera] = useState<ResumenCartera | null>(null);
  const [cargando, setCargando] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  // Los hallazgos por revisar: al abrir el panel y cada vez que la auditoría
  // guarda su resumen (en esta pestaña o en otra).
  useEffect(() => {
    if (!puede("auditoria")) return;
    const leer = () => setPorRevisar(leerResumenAuditoria()?.total ?? 0);
    leer();
    window.addEventListener(EVENTO_RESUMEN_AUDITORIA, leer);
    window.addEventListener("storage", leer);
    return () => {
      window.removeEventListener(EVENTO_RESUMEN_AUDITORIA, leer);
      window.removeEventListener("storage", leer);
    };
  }, [puede]);

  useEffect(() => {
    if (!abierta || !puede("inicio")) return;
    let vivo = true;
    setCargando(true);
    fetch("/api/admin/resumen")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo && j) setCartera(j as ResumenCartera);
      })
      .catch(() => {})
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [abierta, puede]);

  // Se cierra con Esc o tocando fuera.
  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: PointerEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierta(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierta(false);
    };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierta]);

  const avisos: Aviso[] = [];
  if (enMantenimiento) {
    avisos.push({
      id: "mantenimiento",
      Icono: Wrench,
      titulo: "La consulta está en mantenimiento",
      detalle: "Los consultores no pueden consultar su cartera.",
      ir: puede("mantenimiento") ? "mantenimiento" : null,
      tono: "aviso",
    });
  }
  if (puede("auditoria") && porRevisar > 0) {
    avisos.push({
      id: "auditoria",
      Icono: ClipboardCheck,
      titulo: `${cifra(porRevisar)} ${porRevisar === 1 ? "hallazgo" : "hallazgos"} por revisar`,
      detalle: "De la última auditoría de datos.",
      ir: "auditoria",
      tono: "neutro",
    });
  }
  if (cartera?.general.sin_ubicacion) {
    avisos.push({
      id: "sin-ubicacion",
      Icono: MapPin,
      titulo: `${cifra(cartera.general.sin_ubicacion)} puntos sin coordenadas`,
      detalle: "No aparecen en el mapa del consultor.",
      ir: "inicio",
      tono: "alerta",
    });
  }
  if (cartera?.ultimaCarga?.filas_error) {
    avisos.push({
      id: "observaciones",
      Icono: FileSpreadsheet,
      titulo: `${cifra(cartera.ultimaCarga.filas_error)} filas con observaciones en el último cargue`,
      detalle: cartera.ultimaCarga.archivo,
      ir: "inicio",
      tono: "aviso",
    });
  }
  if (cartera?.general.libres) {
    avisos.push({
      id: "libres",
      Icono: UserX,
      titulo: `${cifra(cartera.general.libres)} puntos sin consultor (LIBRE)`,
      detalle: "En toda la cartera.",
      ir: "inicio",
      tono: "neutro",
    });
  }

  const conPunto = enMantenimiento || (puede("auditoria") && porRevisar > 0);

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        aria-haspopup="dialog"
        aria-label={conPunto ? "Avisos (hay pendientes)" : "Avisos"}
        title="Avisos"
        className="relative grid h-9 w-9 place-items-center rounded-full text-[var(--color-tinta-suave)] hover:bg-[var(--color-hover)] hover:text-[var(--color-tinta)]"
      >
        <Bell size={18} aria-hidden />
        {conPunto && (
          <span
            aria-hidden
            className="absolute top-[7px] right-[8px] h-2 w-2 rounded-full bg-[var(--color-alerta)] ring-2 ring-[var(--color-base)]"
          />
        )}
      </button>

      {abierta && (
        <div
          role="dialog"
          aria-label="Avisos"
          className="tarjeta absolute top-full right-0 z-40 mt-2 w-[min(340px,calc(100vw-24px))] p-2 shadow-[0_16px_40px_-12px_var(--color-sombra)]"
        >
          <p className="px-2.5 pt-1.5 pb-2 text-[13px] font-semibold">Para revisar</p>
          {avisos.length === 0 ? (
            <p className="flex items-center gap-2 px-2.5 pb-2.5 text-[13px] text-[var(--color-tinta-suave)]">
              {cargando ? (
                <>
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                  Revisando…
                </>
              ) : (
                "Todo en orden: no hay nada pendiente."
              )}
            </p>
          ) : (
            <ul>
              {avisos.map((a) => {
                const contenido = (
                  <>
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${TONO[a.tono]}`}>
                      <a.Icono size={15} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] leading-snug font-semibold">{a.titulo}</span>
                      <span className="block truncate text-xs text-[var(--color-tinta-suave)]">{a.detalle}</span>
                    </span>
                  </>
                );
                return (
                  <li key={a.id}>
                    {a.ir ? (
                      <a
                        href={`#${a.ir}`}
                        onClick={() => setAbierta(false)}
                        className="flex items-center gap-3 rounded-[12px] px-2.5 py-2 hover:bg-[var(--color-hover)]"
                      >
                        {contenido}
                      </a>
                    ) : (
                      <div className="flex items-center gap-3 px-2.5 py-2">{contenido}</div>
                    )}
                  </li>
                );
              })}
              {cargando && (
                <li className="flex items-center gap-2 px-2.5 py-2 text-xs text-[var(--color-tinta-suave)]">
                  <Loader2 size={13} className="animate-spin" aria-hidden />
                  Contando lo de la cartera…
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
