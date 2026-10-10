-- =====================================================================
-- Panel: actividad reciente y revisión de fotos
-- Ejecutar DESPUÉS de gestion.sql. Se puede volver a ejecutar sin problema.
--
-- Sin este archivo el panel sigue funcionando: el Inicio muestra solo las
-- cargas y las ediciones de puntos (que ya se guardaban), y en la auditoría
-- de imágenes no se puede marcar una foto como correcta o para revisar.
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
-- Quitar la marca borra la fila.
-- ---------------------------------------------------------------------
create table if not exists public.revision_fotos (
    clave              text primary key,
    estado             text not null check (estado in ('correcta', 'revisar')),
    cod_personalizado  text,
    nombre_usuario     text,
    fecha_inicio       text,
    foto               text,
    revisado_por       text,
    updated_at         timestamptz not null default now()
);

create index if not exists ix_revision_fotos_estado
    on public.revision_fotos (estado, updated_at desc);

alter table public.revision_fotos enable row level security;
alter table public.revision_fotos force row level security;
revoke all on public.revision_fotos from anon, authenticated;

-- Consultas útiles:
-- select * from public.actividad_panel order by created_at desc limit 50;
-- select estado, count(*) from public.revision_fotos group by estado;
-- select * from public.revision_fotos where estado = 'revisar' order by updated_at desc;
