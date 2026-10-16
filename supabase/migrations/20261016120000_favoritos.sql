-- Favoritos: marca documentos importantes para tenerlos siempre a mano.
-- La política existente «documentos del usuario» ya limita leer y cambiar
-- esta columna a los documentos propios; no hace falta una política nueva.

alter table public.documentos
  add column if not exists favorito boolean not null default false;

-- Acelera la vista «Favoritos» (solo indexa las filas marcadas).
create index if not exists documentos_favoritos_idx
  on public.documentos (user_id)
  where favorito;
