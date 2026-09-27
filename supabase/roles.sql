-- =====================================================================
-- Perfiles: administrador y BackOffice
-- Ejecutar DESPUÉS de admins.sql
--
-- admin      → panel completo: cargar, editar, borrar, mantenimiento, usuarios
-- backoffice → solo consultar la cartera de un vendedor y descargarla
-- =====================================================================

alter table public.admins
    add column if not exists rol text not null default 'admin';

-- Postgres no tiene "add constraint if not exists", así que se comprueba.
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'admins_rol_valido'
    ) then
        alter table public.admins
            add constraint admins_rol_valido
            check (rol in ('admin', 'backoffice'));
    end if;
end $$;

-- ---------------------------------------------------------------------
-- crear_admin ahora recibe el rol.
-- Hay que borrar la versión de 3 argumentos: si se deja, una llamada con
-- tres parámetros queda ambigua entre las dos y Postgres la rechaza.
-- ---------------------------------------------------------------------
drop function if exists public.crear_admin(text, text, text);
drop function if exists public.crear_admin(text, text, text, text);

create function public.crear_admin(
    p_usuario text,
    p_clave   text,
    p_nombre  text default null,
    p_rol     text default 'admin'
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

    if p_rol not in ('admin', 'backoffice') then
        raise exception 'Rol no válido: %', p_rol;
    end if;

    insert into public.admins (usuario, nombre, clave_hash, rol)
    values (
        lower(trim(p_usuario)),
        p_nombre,
        crypt(p_clave, gen_salt('bf', 12)),
        p_rol
    )
    on conflict (usuario) do update
        set clave_hash = excluded.clave_hash,
            nombre     = coalesce(excluded.nombre, public.admins.nombre),
            rol        = excluded.rol,
            activo     = true;
end $$;

-- ---------------------------------------------------------------------
-- verificar_admin devuelve también el rol. Cambia el tipo de retorno,
-- así que toca borrarla antes de recrearla.
-- ---------------------------------------------------------------------
drop function if exists public.verificar_admin(text, text);

create function public.verificar_admin(
    p_usuario text,
    p_clave   text
)
returns table (usuario text, nombre text, rol text)
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
    returning a.usuario, a.nombre, a.rol;
end $$;

revoke execute on function public.crear_admin(text, text, text, text) from anon, authenticated;
revoke execute on function public.verificar_admin(text, text) from anon, authenticated;

-- Consultas útiles:
-- select usuario, nombre, rol, activo from public.admins order by rol, usuario;
-- select public.crear_admin('soporte1', 'clave-larga-y-unica', 'Soporte 1', 'backoffice');
-- update public.admins set rol = 'backoffice' where usuario = 'alguien';
