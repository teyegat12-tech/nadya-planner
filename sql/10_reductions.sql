-- ПЛАНЕР: обновление 10 — привычки «Сокращение» (курение, сладкое и т. п.)
-- Можно запускать повторно: ничего не сломает и не удалит.
create table if not exists public.reductions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);
alter table public.reductions add column if not exists unit text not null default 'шт';
alter table public.reductions add column if not exists baseline numeric not null default 0;
alter table public.reductions add column if not exists days int not null default 21;
alter table public.reductions add column if not exists start_date date not null default current_date;
alter table public.reductions add column if not exists archived boolean not null default false;
create index if not exists reductions_user_idx on public.reductions (user_id);

create table if not exists public.reduction_entries (
  reduction_id uuid not null references public.reductions(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  amount numeric not null default 0,
  created_at timestamptz not null default now(),
  primary key (reduction_id, date)
);

do $$
declare t text;
begin
  foreach t in array array['reductions', 'reduction_entries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then null;
    end;
  end loop;
end $$;
