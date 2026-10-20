-- =====================================================================
-- Panel: actividad reciente, revisión de fotos, queries de fotos, fotos
-- repetidas y lo que la IA ve en las fotos
-- Ejecutar DESPUÉS de gestion.sql. Se puede volver a ejecutar sin problema.
--
-- Sin este archivo el panel sigue funcionando: el Inicio muestra solo las
-- cargas y las ediciones de puntos (que ya se guardaban), en las auditorías
-- de fotos no se puede marcar una foto como correcta o para revisar, y en la
-- Auditoría con query no se pueden guardar queries.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Actividad del panel
-- Lo que hace cada usuario del panel y no quedaba en otra tabla: abrir o
-- cerrar el mantenimiento, crear usuarios, cambiarles la clave o el perfil,
-- activarlos o desactivarlos, y cambiar tableros o temas. Las cargas siguen
-- en cargas_cartera y las ediciones de puntos en auditoria_cartera; el Inicio
-- junta las tres.
-- ---------------------------------------------------------------------
create table if not exists public.actividad_panel (
    id          bigint primary key generated always as identity,
    usuario     text,
    accion      text not null,
    detalle     jsonb,
    created_at  timestamptz not null default now()
);

create index if not exists ix_actividad_panel_fecha
    on public.actividad_panel (created_at desc);

alter table public.actividad_panel enable row level security;
alter table public.actividad_panel force row level security;
revoke all on public.actividad_panel from anon, authenticated;

-- ---------------------------------------------------------------------
-- Revisión de fotos (auditoría de imágenes)
-- Una fila por foto revisada. La foto se reconoce por una huella del enlace
-- (clave), que calcula el panel: la consulta de Athena no trae un id de la
-- visita. Se guardan también el código, el consultor y la fecha para poder
-- consultar esto sin depender de Athena.
--   estado = correcta → la foto sirve
--   estado = revisar  → hay que revisarla con el consultor
--   estado = pendiente → se miró, pero falta decidir
-- Quitar la marca borra la fila.
-- ---------------------------------------------------------------------
create table if not exists public.revision_fotos (
    clave              text primary key,
    estado             text not null check (estado in ('correcta', 'revisar', 'pendiente')),
    cod_personalizado  text,
    nombre_usuario     text,
    fecha_inicio       text,
    foto               text,
    revisado_por       text,
    updated_at         timestamptz not null default now()
);

-- «Pendiente» se agregó después: en una base que ya tenía la tabla, se
-- cambia la regla (volver a ejecutar esto no hace daño).
alter table public.revision_fotos drop constraint if exists revision_fotos_estado_check;
alter table public.revision_fotos add constraint revision_fotos_estado_check
    check (estado in ('correcta', 'revisar', 'pendiente'));

create index if not exists ix_revision_fotos_estado
    on public.revision_fotos (estado, updated_at desc);

alter table public.revision_fotos enable row level security;
alter table public.revision_fotos force row level security;
revoke all on public.revision_fotos from anon, authenticated;

-- ---------------------------------------------------------------------
-- Queries guardadas de la Auditoría con query
-- El SQL que se corre en Athena para traer fotos, con un nombre para
-- elegirlo de una lista. columnas dice qué columna del resultado es la
-- foto, la fecha, el PDV, el consultor y el código, por ejemplo:
--   {"foto": "foto_visita_fin", "fecha": "fecha_fin", "pdv": "nombre_pdv",
--    "consultor": "nombre_usuario", "codigo": "cod_personalizado"}
-- Las marcas de las fotos van en revision_fotos, igual que en la auditoría
-- de imágenes.
-- ---------------------------------------------------------------------
create table if not exists public.queries_fotos (
    id               bigint primary key generated always as identity,
    nombre           text not null check (length(trim(nombre)) between 1 and 80),
    sql              text not null,
    columnas         jsonb not null default '{}'::jsonb,
    creado_por       text,
    actualizado_por  text,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create unique index if not exists ux_queries_fotos_nombre
    on public.queries_fotos (lower(trim(nombre)));

alter table public.queries_fotos enable row level security;
alter table public.queries_fotos force row level security;
revoke all on public.queries_fotos from anon, authenticated;

-- ---------------------------------------------------------------------
-- Fotos repetidas (Auditoría con query)
-- huellas_fotos: la huella visual de cada foto, para no volver a
-- descargarla. clave es la huella del enlace (como en revision_fotos);
-- huella son 16 caracteres hexadecimales; plana dice si la foto es casi de
-- un solo color; error, por qué no se pudo leer (404, no es imagen…).
-- repetidas_ia: lo que dijo la IA de cada par de fotos parecidas, para no
-- volver a preguntarle (y pagarle) por el mismo par.
-- ---------------------------------------------------------------------
create table if not exists public.huellas_fotos (
    clave       text primary key,
    huella      text,
    plana       boolean not null default false,
    error       text,
    created_at  timestamptz not null default now()
);

alter table public.huellas_fotos enable row level security;
alter table public.huellas_fotos force row level security;
revoke all on public.huellas_fotos from anon, authenticated;

create table if not exists public.repetidas_ia (
    par         text primary key,
    misma       boolean not null,
    motivo      text,
    ia          text,
    pedido_por  text,
    created_at  timestamptz not null default now()
);

alter table public.repetidas_ia enable row level security;
alter table public.repetidas_ia force row level security;
revoke all on public.repetidas_ia from anon, authenticated;

-- ---------------------------------------------------------------------
-- Qué se ve en cada foto, según la IA (Auditoría con query)
-- Una fila por foto y etiqueta (lo que se le pidió buscar: libro, afiche…):
-- presente dice si la IA la vio. La etiqueta «ilegible» marca las fotos
-- borrosas u oscuras. clave es la huella del enlace, como en las demás.
-- ---------------------------------------------------------------------
create table if not exists public.etiquetas_fotos (
    clave       text not null,
    etiqueta    text not null,
    presente    boolean not null,
    ia          text,
    created_at  timestamptz not null default now(),
    primary key (clave, etiqueta)
);

alter table public.etiquetas_fotos enable row level security;
alter table public.etiquetas_fotos force row level security;
revoke all on public.etiquetas_fotos from anon, authenticated;

-- Consultas útiles:
-- select * from public.actividad_panel order by created_at desc limit 50;
-- select estado, count(*) from public.revision_fotos group by estado;
-- select * from public.revision_fotos where estado = 'revisar' order by updated_at desc;
-- select id, nombre, actualizado_por, updated_at from public.queries_fotos order by nombre;
