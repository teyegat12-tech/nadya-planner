-- ПЛАНЕР: обновление 8 — события из Google / iCloud календарей в планере (только чтение)
create table if not exists public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  url text not null,
  color text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists calendar_feeds_user_idx on public.calendar_feeds (user_id);
alter table public.calendar_feeds enable row level security;
drop policy if exists "own feeds" on public.calendar_feeds;
create policy "own feeds" on public.calendar_feeds
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.calendar_feeds to authenticated;
revoke all on public.calendar_feeds from anon;

-- задача, сделанная из события: помним событие, чтобы не показывать его дважды
alter table public.tasks add column if not exists source_uid text;
