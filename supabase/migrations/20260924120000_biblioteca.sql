-- =============================================================================
-- Fase 1 · Biblioteca en la nube
-- Carpetas (con subcarpetas), documentos, versiones, etiquetas y bucket privado,
-- todo protegido con RLS por usuario (user_id = auth.uid()).
-- Ejecutar completo en: Supabase › SQL Editor.
-- =============================================================================

-- Mantiene updated_at al día en cada modificación.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Carpetas
-- -----------------------------------------------------------------------------
create table public.carpetas (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  carpeta_padre_id uuid,
  nombre           text not null check (char_length(btrim(nombre)) between 1 and 120),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Permite claves foráneas compuestas: así nadie puede colgar algo de una carpeta ajena.
  unique (id, user_id),
  -- Al borrar una carpeta se borran sus subcarpetas (los documentos NO: pasan a la raíz).
  foreign key (carpeta_padre_id, user_id) references public.carpetas (id, user_id) on delete cascade,
  check (carpeta_padre_id is distinct from id)
);

-- Nombre único entre carpetas hermanas (sin distinguir mayúsculas).
create unique index carpetas_nombre_unico
  on public.carpetas (user_id, coalesce(carpeta_padre_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(nombre));
create index carpetas_padre_idx on public.carpetas (carpeta_padre_id);

-- Impide mover una carpeta dentro de sí misma o de una de sus subcarpetas.
create or replace function public.carpetas_evitar_ciclos()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.carpeta_padre_id is not null and exists (
    with recursive ancestros as (
      select c.id, c.carpeta_padre_id from public.carpetas c where c.id = new.carpeta_padre_id
      union all
      select c.id, c.carpeta_padre_id from public.carpetas c join ancestros a on c.id = a.carpeta_padre_id
    )
    select 1 from ancestros where id = new.id
  ) then
    raise exception 'Una carpeta no puede moverse dentro de sí misma ni de una de sus subcarpetas.';
  end if;
  return new;
end;
$$;

create trigger carpetas_evitar_ciclos
  before update of carpeta_padre_id on public.carpetas
  for each row execute function public.carpetas_evitar_ciclos();

create trigger carpetas_updated_at
  before update on public.carpetas
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Documentos
-- -----------------------------------------------------------------------------
create table public.documentos (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  carpeta_id       uuid,                      -- null = raíz
  nombre           text not null check (char_length(btrim(nombre)) between 1 and 200),
  origen           text not null default 'app'
                   check (origen in ('app', 'camscanner', 'importado')),
  estado_ocr       text not null default 'no_requerido'
                   check (estado_ocr in ('no_requerido', 'pendiente', 'procesando', 'completado', 'error')),
  texto_ocr        text,                      -- texto extraído con pdf.js o con OCR
  error_ocr        text,
  paginas          integer check (paginas >= 0),
  version_actual   integer not null default 1 check (version_actual >= 1),
  miniatura_path   text,                      -- ruta en Storage de la miniatura de la página 1
  fecha_documento  date,                      -- fecha del propio documento (opcional, para filtrar)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, user_id),
  -- Si se borra la carpeta, el documento se conserva y pasa a la raíz.
  foreign key (carpeta_id, user_id) references public.carpetas (id, user_id) on delete set null (carpeta_id)
);

create index documentos_carpeta_idx on public.documentos (user_id, carpeta_id);
create index documentos_creado_idx on public.documentos (user_id, created_at desc);
create index documentos_ocr_pendiente_idx on public.documentos (user_id) where estado_ocr = 'pendiente';

create trigger documentos_updated_at
  before update on public.documentos
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Versiones de cada documento (la versión 1 es siempre el original y nunca se borra
-- al mejorar; las mejoras de la fase 5 se guardan como versiones nuevas)
-- -----------------------------------------------------------------------------
create table public.documento_versiones (
  id            uuid primary key default gen_random_uuid(),
  documento_id  uuid not null,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  numero        integer not null check (numero >= 1),
  storage_path  text not null unique,
  tamano_bytes  bigint not null check (tamano_bytes >= 0),
  paginas       integer check (paginas >= 0),
  motivo        text not null default 'original' check (motivo in ('original', 'mejora')),
  created_at    timestamptz not null default now(),
  unique (documento_id, numero),
  foreign key (documento_id, user_id) references public.documentos (id, user_id) on delete cascade,
  -- El archivo debe estar dentro de la carpeta del propio usuario en el bucket.
  check (storage_path like user_id::text || '/%')
);

-- -----------------------------------------------------------------------------
-- Etiquetas
-- -----------------------------------------------------------------------------
create table public.etiquetas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nombre      text not null check (char_length(btrim(nombre)) between 1 and 50),
  color       text check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz not null default now(),
  unique (id, user_id)
);

create unique index etiquetas_nombre_unico on public.etiquetas (user_id, lower(nombre));

create table public.documento_etiquetas (
  documento_id  uuid not null,
  etiqueta_id   uuid not null,
  user_id       uuid not null default auth.uid(),
  created_at    timestamptz not null default now(),
  primary key (documento_id, etiqueta_id),
  foreign key (documento_id, user_id) references public.documentos (id, user_id) on delete cascade,
  foreign key (etiqueta_id, user_id) references public.etiquetas (id, user_id) on delete cascade
);

create index documento_etiquetas_etiqueta_idx on public.documento_etiquetas (etiqueta_id);

-- -----------------------------------------------------------------------------
-- Seguridad a nivel de fila: cada usuario solo ve y modifica lo suyo
-- -----------------------------------------------------------------------------
alter table public.carpetas            enable row level security;
alter table public.documentos          enable row level security;
alter table public.documento_versiones enable row level security;
alter table public.etiquetas           enable row level security;
alter table public.documento_etiquetas enable row level security;

create policy "carpetas del usuario" on public.carpetas
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "documentos del usuario" on public.documentos
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "versiones del usuario" on public.documento_versiones
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "etiquetas del usuario" on public.etiquetas
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "etiquetas de documentos del usuario" on public.documento_etiquetas
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Storage: bucket privado "documentos"
-- Rutas: {user_id}/{documento_id}/v{n}.pdf  y  {user_id}/{documento_id}/miniatura.jpg
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 52428800, array['application/pdf', 'image/jpeg'])
on conflict (id) do nothing;

create policy "documentos: leer archivos propios" on storage.objects
  for select to authenticated
  using (bucket_id = 'documentos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "documentos: subir archivos propios" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documentos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "documentos: borrar archivos propios" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documentos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Sin política de UPDATE a propósito: un archivo subido no se puede sobrescribir.
-- Cada cambio se guarda como archivo (versión) nuevo.
