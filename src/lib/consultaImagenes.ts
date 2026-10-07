/**
 * Consulta de la auditoría de imágenes en Athena: la foto con la que cada
 * consultor inició la visita y cuándo la inició.
 *
 * SOLO SERVIDOR: el navegador nunca manda SQL. La ruta
 * /api/admin/auditoria-imagenes ejecuta siempre este texto y nada más.
 *
 * Va tal cual se entregó. La campaña (campana_id = 2423) está fija aquí: para
 * auditar otra campaña se cambia en este archivo.
 */
export const SQL_IMAGENES = String.raw`SELECT 
    nombre_pdv,
    nombre_usuario,
    cod_personalizado,
    foto_visita_inicio,
    fecha_inicio
FROM dim_lf_general_cobertura
WHERE campana_id = 2423
  AND inicio_visita_id IS NOT NULL
  AND pdv_id NOT IN (5230016, 108);`;
