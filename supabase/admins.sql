-- =====================================================================
-- Administradores en base de datos (opcional)
-- Reemplaza la clave única de ADMIN_PASSWORD por usuarios con nombre,
-- para poder registrar quién cargó cada archivo.
--
-- Ejecutar DESPUÉS de schema.sql
-- =====================================================================

-- Supabase instala pgcrypto en el esquema 'extensions'.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.admins (
    id           bigint primary key generated always as identity,
    usuario      text not null unique,
    nombre       text,
    clave_hash   text not null,          -- bcrypt, nunca la clave en claro
    activo       boolean not null default true,
    ultimo_login timestamptz,
    created_at   timestamptz not null default now()
);

-- Cerrada a anon/authenticated: solo se toca por RPC o service_role.
alter table public.admins enable row level security;
alter table public.admins force row level security;
revoke all on public.admins from anon, authenticated;

-- ---------------------------------------------------------------------
-- Crear o actualizar un administrador
-- ---------------------------------------------------------------------
create or replace function public.crear_admin(
    p_usuario text,
    p_clave   text,
    p_nombre  text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if length(p_clave) < 10 then
        raise exception 'La clave debe tener al menos 10 caracteres.';
    end if;

    insert into public.admins (usuario, nombre, clave_hash)
    values (lower(trim(p_usuario)), p_nombre, crypt(p_clave, gen_salt('bf', 12)))
    on conflict (usuario) do update
        set clave_hash = excluded.clave_hash,
            nombre     = coalesce(excluded.nombre, public.admins.nombre),
            activo     = true;
end $$;

-- ---------------------------------------------------------------------
-- Verificar credenciales. Devuelve la fila si coincide, nada si no.
-- La comparación ocurre dentro de Postgres: el hash nunca sale del motor.
-- ---------------------------------------------------------------------
create or replace function public.verificar_admin(
    p_usuario text,
    p_clave   text
)
returns table (usuario text, nombre text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    return query
    update public.admins a
       set ultimo_login = now()
     where a.usuario = lower(trim(p_usuario))
       and a.activo
       and a.clave_hash = crypt(p_clave, a.clave_hash)
    returning a.usuario, a.nombre;
end $$;

revoke execute on function public.crear_admin(text, text, text) from anon, authenticated;
revoke execute on function public.verificar_admin(text, text) from anon, authenticated;

-- ---------------------------------------------------------------------
-- Registrar quién hizo cada carga
-- ---------------------------------------------------------------------
alter table public.cargas_cartera
    add column if not exists cargado_por text;

-- ---------------------------------------------------------------------
-- Primer administrador. Cambia el usuario y la clave antes de ejecutar,
-- y borra esta línea del historial del SQL Editor cuando termines.
-- ---------------------------------------------------------------------
-- select public.crear_admin('joan', 'clave-larga-y-unica', 'Joan');

-- Consultas útiles:
-- select usuario, nombre, activo, ultimo_login from public.admins order by usuario;
-- update public.admins set activo = false where usuario = 'alguien';   -- revocar acceso
-- select public.crear_admin('joan', 'nueva-clave');                    -- cambiar clave
