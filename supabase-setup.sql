-- Reventix: configuración de Supabase
-- Pega este script entero en Supabase -> SQL Editor -> New query -> Run.
-- Es seguro ejecutarlo más de una vez.

-- 1) Tabla de prendas (una fila por prenda; "data" guarda todos los campos salvo las fotos)
create table if not exists public.items (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  photo_paths text[] not null default '{}',
  updated_at  bigint not null,
  deleted     boolean not null default false
);

create index if not exists items_user_idx on public.items(user_id);

-- 2) Seguridad: cada usuario solo ve y toca sus propias filas
alter table public.items enable row level security;

drop policy if exists "items_select_own" on public.items;
drop policy if exists "items_insert_own" on public.items;
drop policy if exists "items_update_own" on public.items;
drop policy if exists "items_delete_own" on public.items;

create policy "items_select_own" on public.items
  for select to authenticated using (auth.uid() = user_id);
create policy "items_insert_own" on public.items
  for insert to authenticated with check (auth.uid() = user_id);
create policy "items_update_own" on public.items
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "items_delete_own" on public.items
  for delete to authenticated using (auth.uid() = user_id);

-- 3) Almacén privado de fotos (carpeta por usuario: <user_id>/<prenda>/<foto>.jpg)
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "photos_select_own" on storage.objects;
drop policy if exists "photos_insert_own" on storage.objects;
drop policy if exists "photos_update_own" on storage.objects;
drop policy if exists "photos_delete_own" on storage.objects;

create policy "photos_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
