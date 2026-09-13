-- =====================================================================
-- Cartera LiveTrade - esquema Supabase
-- Ejecutar en: SQL Editor del proyecto
-- =====================================================================

create table if not exists public.puntos_cartera (
    id_registro      bigint primary key generated always as identity,

    -- Columnas A-G: lo que ve y descarga el vendedor
    id_pdv           text not null,              -- A: ID
    bavaria          text,                       -- B: BAVARIA
    pdv              text,                       -- C: PDV
    direccion        text,                       -- D: DIRECCION
    persona_hacku    text,                       -- E: PERSONA HACKU
    celular          text,                       -- F: CELULAR  (texto: conserva el 57 inicial)
    que_hacer        text,                       -- G: QUE HACER

    fecha_nacimiento date,                       -- H
    ciclo            text not null default '',   -- I
    departamento     text,                       -- J
    ciudad           text,                       -- K

    estado_v1        text,                       -- L
    fecha_v1         date,                       -- M
    hora_v1          text,                       -- N: texto, el Excel mezcla 'HH:MM:SS' y fracciones
    usuario_v1       text,                       -- O
    hacku_estado     text,                       -- P
    hacku_curso      text,                       -- Q
    estado_v2        text,                       -- R
    fecha_v2         date,                       -- S
    hora_v2          text,                       -- T
    usuario_v2       text,                       -- U ("USUSARIO V2" en la plantilla)
    estado_v3        text,                       -- V
    fecha_v3         date,                       -- W
    hora_v3          text,                       -- X
    usuario_v3       text,                       -- Y
    motivo           text,                       -- Z
    motivo_dueno     text,                       -- AA
    comentario       text,                       -- AB
    duracion_v1      text,                       -- AC

    ruta             integer,                    -- AD: orden/agrupación de visita (0-17)
    latitud          double precision,           -- AE
    longitud         double precision,           -- AF
    num_de_ruta      integer,                    -- AG: ruta asignada a la persona
    persona          text,                       -- AH
    ccuser           text not null,              -- AI: cédula ('LIBRE' si no está asignado)
    usuario          text not null,              -- AJ: 'user' en la plantilla
    nom              text,                       -- AK

    -- Trazabilidad de la carga
    archivo_origen   text,
    coord_corregida  boolean not null default false,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

-- 'user' es palabra reservada en Postgres. Usamos 'usuario' en la tabla y
-- mapeamos desde la columna 'user' del Excel al importar.

-- Clave natural para el UPSERT: un PDV no se repite dentro del mismo ciclo.
create unique index if not exists ux_puntos_pdv_ciclo
    on public.puntos_cartera (id_pdv, ciclo);

-- La consulta pública siempre filtra por usuario + cédula.
create index if not exists ix_puntos_usuario_ccuser
    on public.puntos_cartera (usuario, ccuser);

create index if not exists ix_puntos_num_ruta
    on public.puntos_cartera (num_de_ruta);

-- updated_at automático
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_puntos_updated_at on public.puntos_cartera;
create trigger trg_puntos_updated_at
    before update on public.puntos_cartera
    for each row execute function public.set_updated_at();

-- =====================================================================
-- Seguridad
-- =====================================================================
-- La tabla contiene datos personales (cédulas, celulares, nombres y
-- direcciones de terceros). Por eso NO se crea ninguna política para los
-- roles anon/authenticated: con RLS activo y cero políticas, la tabla queda
-- cerrada a la anon key. Toda lectura pasa por /api/cartera, que exige
-- usuario + cédula y usa la service_role key del lado del servidor.

alter table public.puntos_cartera enable row level security;
alter table public.puntos_cartera force row level security;

revoke all on public.puntos_cartera from anon, authenticated;

-- =====================================================================
-- Opcional: histórico de cargas
-- =====================================================================
create table if not exists public.cargas_cartera (
    id           bigint primary key generated always as identity,
    archivo      text not null,
    filas        integer not null,
    filas_ok     integer not null,
    filas_error  integer not null default 0,
    detalle      jsonb,
    created_at   timestamptz not null default now()
);

alter table public.cargas_cartera enable row level security;
