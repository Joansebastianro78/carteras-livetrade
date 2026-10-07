/**
 * Consulta de la auditoría de calidad de datos en Athena.
 *
 * SOLO SERVIDOR: el navegador nunca manda SQL. La ruta /api/admin/auditoria
 * ejecuta siempre este texto y nada más, y solo entrega resultados de
 * ejecuciones cuyo texto coincide con este (ver lib/athena.ts).
 *
 * Va tal cual se entregó. String.raw es obligatorio: las expresiones
 * regulares llevan barras invertidas (\| y \s) que una plantilla normal de
 * JavaScript se comería.
 *
 * Si se cambia la consulta, revisar también motivoAuditoria() en
 * lib/auditoria.ts, que explica en la pantalla por qué salió cada fila.
 */
export const SQL_AUDITORIA = String.raw`SELECT
    p.cod_personalizado AS codigo_bavaria,
    p.nombre_personalizado,
    d.nombre_usuario,
    p.departamento,
    p.provincia,
    d.componente_etiqueta,
    d.componente_valor,
    d.fecha,
    d.actividad_id,
    CASE
        WHEN d.actividad_id IN (12602, 12603, 12604, 12605, 12606) THEN 'Linea base'
        WHEN d.actividad_id = 13346 THEN 'Linea de seguimiento'
        WHEN d.actividad_id = 12663 THEN 'Inscripcion avanza'
        ELSE 'Sin clasificar'
    END AS tipo_linea
FROM dim_lf_general_datos d
INNER JOIN dim_lf_general_campana_pdv p
    ON  p.punto_venta_id = d.punto_venta_id
    AND p.campana_id     = d.campana_id
WHERE
    d.punto_venta_id NOT IN (108, 5230016)
    AND (
        (
            d.componente_etiqueta = '8.Número de identificación'
            AND (
                d.componente_valor IS NULL
                OR TRIM(d.componente_valor) = ''
                OR length(TRIM(d.componente_valor)) < 6
                OR length(TRIM(d.componente_valor)) > 10
                OR regexp_like(TRIM(d.componente_valor), '^0')
                OR NOT regexp_like(TRIM(d.componente_valor), '^[0-9]+$')
            )
        )
        OR
        (
            d.componente_etiqueta = 'Fecha de Nacimiento de la persona dueña del negocio'
            AND d.componente_valor IS NOT NULL
            AND TRIM(d.componente_valor) <> ''
            AND TRY_CAST(d.componente_valor AS DATE) > date_add('year', -18, current_date)
        )
        OR
        (
            -- Domicilios: "No" combinado con otra opción
            d.componente_etiqueta LIKE '%presta servicio de domicilios%'
            AND d.componente_valor LIKE '%|%'
            AND regexp_like(d.componente_valor, '(?i)(^|\|)\s*no\s*(\||$)')
        )
        OR
        (
            -- Preguntas donde solo se traen los "Select"
            (
                d.componente_etiqueta LIKE '%Para dar a conocer su negocio o vender%'
                OR d.componente_etiqueta LIKE '%Con qu% proveedores?'
                OR d.componente_etiqueta LIKE '%barreras que impiden que su negocio crezca%'
                OR d.componente_etiqueta LIKE '%presta servicio de domicilios%'
                OR d.componente_etiqueta LIKE '%formas de pago digital acepta actualmente%'
                OR d.componente_etiqueta LIKE '%acceso a alguno de los siguientes servicios financieros%'
                OR d.componente_etiqueta LIKE '%mobiliario adicional cuenta su negocio%'
                OR d.componente_etiqueta LIKE '%Seleccione si hay disponibilidad de algunos de los siguientes productos%'
                OR d.componente_etiqueta LIKE '%beneficios ha accedido en el tiempo vinculado a Bavaria%'
            )
            AND regexp_like(d.componente_valor, '(?i)select')
        )
        OR
        (
            -- Años del negocio / años en la actividad: mayores a 50
            (
                d.componente_etiqueta LIKE '%tiene el negocio actual%'
                OR d.componente_etiqueta LIKE '%en este tipo de actividad comercial%'
            )
            AND TRY_CAST(regexp_extract(d.componente_valor, '[0-9]+') AS DOUBLE) > 50
        )
        OR
        (
            -- Porcentajes: mayores a 100
            (
                d.componente_etiqueta LIKE '%porcentaje sobra para ahorrar o invertir%'
                OR lower(d.componente_etiqueta) LIKE '%porcentaje proviene de la venta de cerveza%'
            )
            AND TRY_CAST(regexp_extract(d.componente_valor, '[0-9]+') AS DOUBLE) > 100
        )
        OR
        (
            -- Costos y gastos mensuales: fuera del rango 1.000.000 - 30.000.000
            d.componente_etiqueta LIKE '%valor total promedio de los costos y gastos de su negocio en un mes%'
            AND TRY_CAST(
                    regexp_replace(
                        regexp_replace(TRIM(d.componente_valor), '[.,][0-9]{1,2}$', ''),
                        '[^0-9]', ''
                    ) AS DOUBLE
                ) NOT BETWEEN 100000 AND 30000000
        )
        OR
        (
            -- Ingreso diario de ventas: fuera del rango 10.000 - 2.000.000
            d.componente_etiqueta LIKE '%ingreso total aproximado de ventas en un d%'
            AND TRY_CAST(
                    regexp_replace(
                        regexp_replace(TRIM(d.componente_valor), '[.,][0-9]{1,2}$', ''),
                        '[^0-9]', ''
                    ) AS DOUBLE
                ) NOT BETWEEN 10000 AND 2000000
        )
        OR
        (
            -- Edad del participante: menores de 18
            lower(d.componente_etiqueta) LIKE '%edad del participante%'
            AND TRY_CAST(regexp_extract(d.componente_valor, '[0-9]+') AS DOUBLE) < 18
        )
    );`;
