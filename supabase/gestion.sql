-- =====================================================================
-- Vistas y funciones de apoyo para el panel administrador
-- Ejecutar DESPUÉS de schema.sql y admins.sql
-- =====================================================================

-- Resumen por ciclo: alimenta el selector de "eliminar cartera".
create or replace view public.resumen_ciclos as
select
    ciclo,
    count(*)                                   as puntos,
    count(distinct usuario)                    as vendedores,
    count(*) filter (where latitud is null)    as sin_ubicacion,
    max(updated_at)                            as ultima_actualizacion
from public.puntos_cartera
group by ciclo
order by max(updated_at) desc;

-- Las vistas heredan los permisos del creador, así que la cerramos igual
-- que la tabla: solo service_role la consulta.
revoke all on public.resumen_ciclos from anon, authenticated;

-- El histórico de cargas ahora guarda también con qué modo se hizo.
alter table public.cargas_cartera
    add column if not exists modo text;

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
