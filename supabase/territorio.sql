-- =====================================================================
-- Filtro por departamento y ciudad (perfil BackOffice)
-- Ejecutar DESPUÉS de gestion.sql. Se puede volver a ejecutar sin problema.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Clave de comparación
-- El origen no siempre escribe igual el mismo lugar: "Bogotá", "BOGOTA",
-- "bogota " o "BOGOTA D.C." frente a "BOGOTA DC". La clave quita tildes,
-- puntos, comas y espacios repetidos, y pasa todo a mayúsculas, para que el
-- filtro agrupe esas variantes en una sola. El nombre que se muestra sigue
-- siendo el que venía en el archivo.
-- ---------------------------------------------------------------------
create or replace function public.clave_territorio(t text)
returns text
language sql
immutable
parallel safe
as $$
    select nullif(
        btrim(
            regexp_replace(
                upper(
                    translate(
                        coalesce(t, ''),
                        'áéíóúüñàèìòùÁÉÍÓÚÜÑÀÈÌÒÙ.,',
                        'aeiouunaeiouAEIOUUNAEIOU'
                    )
                ),
                '\s+', ' ', 'g'
            )
        ),
        ''
    )
$$;

-- Columnas calculadas por la base: se llenan solas en cada carga y en cada
-- edición, así que el importador no tiene que saber que existen.
alter table public.puntos_cartera
    add column if not exists departamento_clave text
    generated always as (public.clave_territorio(departamento)) stored;

alter table public.puntos_cartera
    add column if not exists ciudad_clave text
    generated always as (public.clave_territorio(ciudad)) stored;

create index if not exists ix_puntos_territorio
    on public.puntos_cartera (departamento_clave, ciudad_clave, ciclo);

-- ---------------------------------------------------------------------
-- Resumen por departamento, ciudad y ciclo: alimenta los selectores.
-- El nombre que se muestra va en mayúsculas y sin espacios de sobra; entre
-- "BOGOTA" y "BOGOTÁ", max() se queda con la versión con tilde.
-- ---------------------------------------------------------------------
drop view if exists public.resumen_territorio;

create view public.resumen_territorio as
select
    departamento_clave,
    ciudad_clave,
    ciclo,
    max(upper(regexp_replace(btrim(departamento), '\s+', ' ', 'g'))) as departamento,
    max(upper(regexp_replace(btrim(ciudad), '\s+', ' ', 'g')))       as ciudad,
    count(*)                                                         as puntos
from public.puntos_cartera
group by departamento_clave, ciudad_clave, ciclo;

-- Igual que las demás vistas: solo la consulta el servidor con service_role.
revoke all on public.resumen_territorio from anon, authenticated;

-- Consultas útiles:
-- select departamento, ciudad, sum(puntos) from public.resumen_territorio
--  group by 1, 2 order by 1, 2;
