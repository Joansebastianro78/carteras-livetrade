"use client";

import { useMemo } from "react";
import {
  exportarImagenes,
  filasDeImagenes,
  ordenarPorFecha,
  type FilaImagen,
} from "@/lib/imagenesAuditoria";
import GaleriaFotos from "./GaleriaFotos";
import { BotonReconsultar, ProgresoConsulta, textoConsulta, useConsultaAthena } from "./ConsultaAthena";

/**
 * Auditoría de imágenes: la foto con la que cada consultor inició la visita,
 * con la consulta fija de lib/consultaImagenes.ts. La pantalla de revisar las
 * fotos es GaleriaFotos, la misma de la Auditoría con query.
 */
export default function AuditoriaImagenes() {
  const {
    fase,
    filas: sinOrdenar,
    info,
    consultar,
    trabajando,
  } = useConsultaAthena<FilaImagen>("/api/admin/auditoria-imagenes", filasDeImagenes);

  /** De la visita más reciente a la más antigua: así salen en la galería y en el Excel. */
  const filas = useMemo(() => ordenarPorFecha(sinOrdenar), [sinOrdenar]);

  return (
    <GaleriaFotos
      prefijo="imagenes"
      titulo="Auditoría de imágenes"
      descripcion={
        info
          ? `Foto de inicio de cada visita · ${textoConsulta(info)}`
          : "La foto con la que cada consultor inició la visita."
      }
      acciones={<BotonReconsultar trabajando={trabajando} onConsultar={() => consultar(true)} />}
      arriba={<ProgresoConsulta fase={fase} onReintentar={() => consultar(false)} />}
      fase={fase}
      filas={filas}
      vacio="La campaña todavía no tiene visitas iniciadas."
      columnaFecha="fecha de inicio"
      nombreFecha="Inicio"
      queFoto="Foto de inicio de visita"
      exportar={exportarImagenes}
    />
  );
}
