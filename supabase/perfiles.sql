-- =====================================================================
-- Perfiles y permisos del panel
-- Ejecutar DESPUÉS de roles.sql (y de panel.sql). Se puede volver a
-- ejecutar sin problema: no borra perfiles ni permisos ya guardados.
--
-- Cada perfil guarda la lista de módulos que ve (columna modulos). Los
-- nombres de los módulos son los de src/lib/permisos.ts:
--   inicio, cargar, editar, consultores, territorio, auditoria, imagenes,
--   tableros, tableros_admin, asistente, mantenimiento, temas, usuarios,
--   perfiles
--
-- Sin este archivo el panel funciona como antes, con los tres perfiles de
-- siempre (superadmin, admin y backoffice) y sus permisos de siempre.
-- =====================================================================

create table if not exists public.perfiles (
    clave        text primary key
                 check (clave ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
    nombre       text not null check (length(btrim(nombre)) between 2 and 60),
    descripcion  text,
    modulos      text[] not null default '{}',
    -- Los tres de siempre: no se pueden borrar.
    sistema      boolean not null default false,
    actualizado_por text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

-- Los tres perfiles de siempre. "on conflict do nothing": al volver a
-- ejecutar el archivo no se pisan los permisos que se hayan cambiado.
insert into public.perfiles (clave, nombre, descripcion, modulos, sistema) values
  ('superadmin', 'Superadministrador',
   'Todo el panel. Es el único que puede tocar a otro superadministrador.',
   array['inicio','cargar','editar','consultores','territorio','auditoria','imagenes',
         'tableros','tableros_admin','asistente','rutas','mantenimiento','temas','usuarios','perfiles'],
   true),
  ('admin', 'Administrador',
   'Maneja toda la cartera, los usuarios y la configuración.',
   array['inicio','cargar','editar','consultores','territorio','auditoria','imagenes',
         'tableros','tableros_admin','asistente','rutas','mantenimiento','temas','usuarios','perfiles'],
   true),
  ('backoffice', 'BackOffice',
   'Consulta: la cartera de un consultor, las regiones, las auditorías y los tableros.',
   array['consultores','territorio','auditoria','imagenes','tableros','asistente'],
   true)
on conflict (clave) do nothing;

-- Si algún usuario tiene un perfil que no está en la tabla, se crea vacío
-- (sin módulos) para no dejarlo huérfano; un administrador le pone permisos.
insert into public.perfiles (clave, nombre, modulos)
select distinct a.rol, a.rol, '{}'::text[]
  from public.admins a
 where a.rol is not null
   and a.rol ~ '^[a-z0-9][a-z0-9_-]{1,39}$'
   and not exists (select 1 from public.perfiles p where p.clave = a.rol)
on conflict (clave) do nothing;

-- El perfil de cada usuario ahora tiene que existir en perfiles. La regla
-- vieja (solo admin, backoffice o superadmin) se cambia por la llave.
alter table public.admins drop constraint if exists admins_rol_valido;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'admins_rol_perfil') then
        alter table public.admins
            add constraint admins_rol_perfil
            foreign key (rol) references public.perfiles (clave)
            on update cascade on delete restrict;
    end if;
end $$;

-- updated_at al día en cada cambio.
create or replace function public.perfiles_tocar()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end $$;

drop trigger if exists perfiles_updated_at on public.perfiles;
create trigger perfiles_updated_at
    before update on public.perfiles
    for each row execute function public.perfiles_tocar();

-- ---------------------------------------------------------------------
-- crear_admin acepta cualquier perfil que exista en la tabla.
-- (roles.sql trae la misma versión: da igual en qué orden se vuelvan a
-- ejecutar los dos archivos.)
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

    if to_regclass('public.perfiles') is not null then
        if not exists (select 1 from public.perfiles where clave = p_rol) then
            raise exception 'Rol no válido: %', p_rol;
        end if;
    elsif p_rol not in ('admin', 'backoffice', 'superadmin') then
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

revoke execute on function public.crear_admin(text, text, text, text) from anon, authenticated;

-- Igual que las demás tablas: solo la toca el servidor con service_role.
alter table public.perfiles enable row level security;
alter table public.perfiles force row level security;
revoke all on public.perfiles from anon, authenticated;

-- Consultas útiles:
-- select clave, nombre, modulos from public.perfiles order by sistema desc, nombre;
-- select a.usuario, a.rol, p.nombre from public.admins a join public.perfiles p on p.clave = a.rol;
-- update public.perfiles set modulos = array_append(modulos, 'asistente') where clave = 'admin';
-- Darle el Generador Rutas a los administradores de una instalación que ya existía
-- (también se puede marcar en Configuración › Perfiles y permisos):
-- update public.perfiles set modulos = array_append(modulos, 'rutas')
--  where clave = 'admin' and not ('rutas' = any(modulos));
