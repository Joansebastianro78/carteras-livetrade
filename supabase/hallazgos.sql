-- =====================================================================
-- Hallazgos revisados de la auditoría de datos
-- Ejecutar una vez, después de panel.sql. Se puede volver a ejecutar sin
-- problema: no borra nada. Si lo ejecutaste antes de que existiera la carga
-- masiva, ejecútalo otra vez: le agrega a la tabla las columnas observacion y
-- archivo, y lo que ya estaba revisado se queda igual.
--
-- Cuando alguien marca un hallazgo como revisado, sale de la lista de la
-- auditoría y queda aquí, con quién y cuándo. La auditoría se vuelve a
-- consultar en Athena cada vez, así que se guarda también una copia de lo que
-- decía el hallazgo (PDV, pregunta, respuesta, motivo...): la sección
-- «Revisados» lo muestra aunque el dato ya se haya corregido y no salga más.
--
-- clave: huella del hallazgo (actividad, código, pregunta, respuesta y fecha;
-- ver src/lib/revisionHallazgos.ts). Si la respuesta cambia y sigue mal,
-- es otro hallazgo y vuelve a salir como pendiente.
-- =====================================================================

create table if not exists public.revision_hallazgos (
    clave           text primary key,
    codigo_bavaria  text,
    pdv             text,
    consultor       text,
    departamento    text,
    provincia       text,
    pregunta        text,
    respuesta       text,
    motivo          text,
    tipo_linea      text,
    actividad_id    text,
    -- La fecha del hallazgo, tal como la trae la consulta.
    fecha_hallazgo  text,
    revisado_por    text,
    revisado_en     timestamptz not null default now()
);

-- Carga masiva (Auditoría de datos › Carga masiva): lo que se anotó al
-- revisar y el Excel con que se cargó. Marcado uno por uno, archivo queda en
-- null. Van aparte para que se agreguen también a una tabla que ya existía.
alter table public.revision_hallazgos add column if not exists observacion text;
alter table public.revision_hallazgos add column if not exists archivo text;

create index if not exists ix_revision_hallazgos_en
    on public.revision_hallazgos (revisado_en desc);

-- Igual que las demás tablas: solo la toca el servidor con service_role.
alter table public.revision_hallazgos enable row level security;
alter table public.revision_hallazgos force row level security;
revoke all on public.revision_hallazgos from anon, authenticated;

-- Consultas útiles:
-- select revisado_por, count(*) from public.revision_hallazgos group by revisado_por order by 2 desc;
-- select * from public.revision_hallazgos order by revisado_en desc limit 50;
-- Lo de una carga masiva: select * from public.revision_hallazgos where archivo = 'revisados_semana_41.xlsx';
-- Devolver uno a pendientes: delete from public.revision_hallazgos where clave = '...';
