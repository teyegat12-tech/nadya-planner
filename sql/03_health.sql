-- ПЛАНЕР: обновление 3 — здоровье, еда, вода, сон

-- цели
alter table public.settings add column if not exists kcal_goal int default 1800;      -- норма калорий в день (еда)
alter table public.settings add column if not exists water_goal int default 2000;     -- вода, мл
alter table public.settings add column if not exists move_goal int default 750;       -- кольцо «Подвижность», ккал
alter table public.settings add column if not exists exercise_goal int default 30;    -- кольцо «Упражнения», мин
alter table public.settings add column if not exists stand_goal int default 12;       -- кольцо «С разминкой/Стоя», часы
alter table public.settings add column if not exists steps_goal int default 8000;      -- цель по шагам

-- активность за день (приходит из «Команд» на iPhone)
create table if not exists public.health_daily (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  date date not null,
  move_kcal numeric, exercise_min numeric, stand_hours numeric,
  steps int, distance_km numeric, flights int,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- тренировки
create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  date date not null,
  type text not null,
  kcal numeric, distance_km numeric, duration_min numeric,
  started_at timestamptz,
  ext_id text,
  created_at timestamptz not null default now(),
  unique (user_id, ext_id)
);
create index if not exists workouts_user_date_idx on public.workouts (user_id, date);

-- сон
create table if not exists public.sleep_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  date date not null,                 -- день, в который проснулась
  bed_at timestamptz, wake_at timestamptz,
  quality smallint check (quality between 1 and 5),
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

-- еда
create table if not exists public.food_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  eaten_at timestamptz not null default now(),
  title text not null,
  kcal numeric not null default 0,
  protein numeric, fat numeric, carbs numeric,
  items jsonb,                         -- разбивка по продуктам от нейросети
  photo_path text,                     -- фото в хранилище
  note text,
  ai boolean not null default false,
  tg_message_id bigint,                -- чтобы поправить ответом в боте
  created_at timestamptz not null default now()
);
create index if not exists food_user_time_idx on public.food_log (user_id, eaten_at);

-- вода
create table if not exists public.water_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  at timestamptz not null default now(),
  ml int not null check (ml > 0 and ml <= 3000)
);
create index if not exists water_user_time_idx on public.water_log (user_id, at);

-- доступ: только свои данные
do $$
declare t text;
begin
  foreach t in array array['health_daily', 'workouts', 'sleep_log', 'food_log', 'water_log'] loop
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

-- закрытая папка для фото еды
insert into storage.buckets (id, name, public)
values ('food', 'food', false)
on conflict (id) do nothing;

drop policy if exists "own food photos read" on storage.objects;
create policy "own food photos read" on storage.objects
  for select to authenticated
  using (bucket_id = 'food' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own food photos write" on storage.objects;
create policy "own food photos write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'food' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own food photos delete" on storage.objects;
create policy "own food photos delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'food' and (storage.foldername(name))[1] = auth.uid()::text);

-- профиль
alter table public.settings add column if not exists display_name text;
alter table public.settings add column if not exists age int;
alter table public.settings add column if not exists height_cm numeric;
alter table public.settings add column if not exists weight_kg numeric;
alter table public.settings add column if not exists goal_weight_kg numeric;
