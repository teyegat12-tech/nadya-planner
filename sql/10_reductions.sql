begin;
create table if not exists public.reductions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  unit text not null default 'сигарет',
  baseline integer not null check (baseline > 0),
  created_at timestamptz not null default now()
);
create table if not exists public.reduction_entries (
  reduction_id uuid not null references public.reductions(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  amount integer not null check (amount >= 0),
  primary key (reduction_id, date)
);
alter table public.reductions enable row level security;
alter table public.reduction_entries enable row level security;
drop policy if exists "own reductions" on public.reductions;
create policy "own reductions" on public.reductions for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own reduction entries" on public.reduction_entries;
create policy "own reduction entries" on public.reduction_entries for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and exists (
  select 1 from public.reductions r where r.id = reduction_id and r.user_id = auth.uid()
));
grant select, insert, update, delete on public.reductions, public.reduction_entries to authenticated;
revoke all on public.reductions, public.reduction_entries from anon;
notify pgrst, 'reload schema';
commit;
