-- =====================================================================
-- Vistas y funciones de apoyo para el panel administrador
-- Ejecutar DESPUÉS de schema.sql y admins.sql
-- =====================================================================

-- Resumen por ciclo: alimenta el selector de "eliminar cartera".
create or replace view public.resumen_ciclos as
select
    ciclo,
    count(*)                                   as puntos,
    count(distinct usuario)                    as consultores,
    count(*) filter (where latitud is null)    as sin_ubicacion,
    max(updated_at)                            as ultima_actualizacion
from public.puntos_cartera
group by ciclo
order by max(updated_at) desc;

-- Las vistas heredan los permisos del creador, así que la cerramos igual
-- que la tabla: solo service_role la consulta.
revoke all on public.resumen_ciclos from anon, authenticated;

-- Resumen por archivo de origen: alimenta la opción de eliminar una carga
-- concreta. Ojo: archivo_origen guarda el ÚLTIMO archivo que tocó el punto,
-- así que un punto corregido después por otro Excel cuenta para ese otro.
create or replace view public.resumen_archivos as
select
    archivo_origen                             as archivo,
    count(*)                                   as puntos,
    count(distinct ciclo)                      as ciclos,
    min(ciclo)                                 as primer_ciclo,
    max(updated_at)                            as ultima_actualizacion
from public.puntos_cartera
where archivo_origen is not null and archivo_origen <> ''
group by archivo_origen
order by max(updated_at) desc;

revoke all on public.resumen_archivos from anon, authenticated;

-- El histórico de cargas ahora guarda también con qué modo se hizo.
alter table public.cargas_cartera
    add column if not exists modo text;

-- Resumen por consultor: alimenta el buscador del BackOffice. Un consultor
-- es la pareja usuario + cédula, que es justo con lo que entra a la página.
-- La vista se llamaba resumen_vendedores: se borra la vieja para no dejar
-- dos copias de lo mismo en la base.
drop view if exists public.resumen_vendedores;
create or replace view public.resumen_consultores as
select
    usuario,
    ccuser,
    max(nom)                                   as nom,
    max(num_de_ruta)                           as num_de_ruta,
    count(*)                                   as puntos,
    count(distinct ciclo)                      as ciclos,
    max(ciclo)                                 as ciclo_reciente,
    count(*) filter (where latitud is null)    as sin_ubicacion,
    max(updated_at)                            as ultima_actualizacion
from public.puntos_cartera
where usuario <> 'LIBRE' and ccuser <> 'LIBRE'
group by usuario, ccuser
order by max(nom);

revoke all on public.resumen_consultores from anon, authenticated;

-- ---------------------------------------------------------------------
-- Ventana de mantenimiento
-- Una sola fila. Mientras activo = true la página pública no consulta.
-- El panel de administración sigue abierto: si no, no se podría apagar.
-- ---------------------------------------------------------------------
create table if not exists public.mantenimiento (
    id               integer primary key default 1 check (id = 1),
    activo           boolean not null default false,
    mensaje          text not null default 'Estamos actualizando la cartera. Vuelve a intentar en unos minutos.',
    hasta            timestamptz,
    actualizado_por  text,
    updated_at       timestamptz not null default now()
);

insert into public.mantenimiento (id) values (1) on conflict (id) do nothing;

alter table public.mantenimiento enable row level security;
alter table public.mantenimiento force row level security;
revoke all on public.mantenimiento from anon, authenticated;

-- ---------------------------------------------------------------------
-- Temas de temporada
-- Una sola fila. Los rangos de fechas viven en el código (src/lib/temas.ts);
-- acá solo queda qué decidió el administrador.
--   modo = automatico → el tema sale solo cuando llega su fecha
--   modo = apagado    → nunca sale nada
--   modo = fijo       → sale siempre tema_fijo, sin mirar el calendario
--   apagados          → temas que el modo automático debe saltarse
-- ---------------------------------------------------------------------
create table if not exists public.tema (
    id               integer primary key default 1 check (id = 1),
    modo             text not null default 'automatico'
                     check (modo in ('automatico', 'apagado', 'fijo')),
    tema_fijo        text,
    apagados         text[] not null default '{}',
    actualizado_por  text,
    updated_at       timestamptz not null default now()
);

insert into public.tema (id) values (1) on conflict (id) do nothing;

alter table public.tema enable row level security;
alter table public.tema force row level security;
revoke all on public.tema from anon, authenticated;

-- ---------------------------------------------------------------------
-- Bitácora de cambios manuales
-- Editar o borrar puntos desde el panel deja rastro aquí.
-- ---------------------------------------------------------------------
create table if not exists public.auditoria_cartera (
    id          bigint primary key generated always as identity,
    accion      text not null check (accion in ('editar', 'eliminar', 'purgar')),
    id_pdv      text,
    ciclo       text,
    detalle     jsonb,
    hecho_por   text,
    created_at  timestamptz not null default now()
);

alter table public.auditoria_cartera enable row level security;
alter table public.auditoria_cartera force row level security;
revoke all on public.auditoria_cartera from anon, authenticated;

create index if not exists ix_auditoria_fecha
    on public.auditoria_cartera (created_at desc);

-- Consultas útiles:
-- select * from public.resumen_ciclos;
-- select * from public.auditoria_cartera order by created_at desc limit 50;
