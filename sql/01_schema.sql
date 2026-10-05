-- ПЛАНЕР: таблицы для задач
-- Вставь целиком в Supabase → SQL Editor → Run

-- 1. Настройки (Telegram, часовой пояс, ссылка для календаря)
create table if not exists public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Europe/Istanbul',
  telegram_chat_id bigint,
  telegram_link_code text unique default substr(md5(random()::text), 1, 8),
  calendar_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- 2. Категории (учёба, тренировки, развивашки и т.д.)
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  emoji text,
  color text not null default '#8b8b8b',
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- 3. Задачи
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null,
  notes text,
  category_id uuid references public.categories(id) on delete set null,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'paused', 'done', 'cancelled')),
  due_date date,                 -- на какой день
  due_time time,                 -- во сколько (можно пусто = «в течение дня»)
  duration_min int default 30,   -- длительность для календаря
  remind_before_min int default 0, -- за сколько минут напомнить (null = не напоминать)
  reminded_at timestamptz,       -- когда бот уже напомнил
  repeat jsonb,                  -- повтор: {"freq":"daily"} или {"freq":"weekly","days":[1,3,5]}
  source text not null default 'manual', -- manual / course / bot
  external_id text,              -- id урока курса или задачи из бота
  sort int not null default 0,
  archived boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);

create index if not exists tasks_user_due_idx on public.tasks (user_id, due_date);
create index if not exists tasks_remind_idx on public.tasks (reminded_at, status) where status <> 'done';

-- updated_at + completed_at автоматически
create or replace function public.tasks_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'done' and (old.status is distinct from 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  -- если сдвинули дату/время — напомнить заново
  if (new.due_date, new.due_time) is distinct from (old.due_date, old.due_time) then
    new.reminded_at := null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
for each row execute function public.tasks_touch();

-- Повторы: отметила повторяющуюся задачу выполненной → создаётся следующая
create or replace function public.tasks_spawn_next() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  next_date date;
  d int;
begin
  if new.repeat is null or new.status <> 'done' or old.status = 'done' or new.due_date is null then
    return new;
  end if;

  if new.repeat->>'freq' = 'daily' then
    next_date := new.due_date + 1;
  elsif new.repeat->>'freq' = 'weekly' then
    next_date := null;
    for i in 1..7 loop
      d := extract(isodow from new.due_date + i)::int;  -- 1=пн … 7=вс
      if new.repeat->'days' @> to_jsonb(d) then
        next_date := new.due_date + i;
        exit;
      end if;
    end loop;
  elsif new.repeat->>'freq' = 'monthly' then
    next_date := (new.due_date + interval '1 month')::date;
  end if;

  if next_date is not null then
    insert into public.tasks (user_id, title, notes, category_id, due_date, due_time,
                              duration_min, remind_before_min, repeat, source)
    values (new.user_id, new.title, new.notes, new.category_id, next_date, new.due_time,
            new.duration_min, new.remind_before_min, new.repeat, new.source);
    -- повтор переехал в новую задачу
    update public.tasks set repeat = null where id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists tasks_spawn_next on public.tasks;
create trigger tasks_spawn_next after update of status on public.tasks
for each row execute function public.tasks_spawn_next();

-- Новый пользователь → настройки + стартовые категории
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.settings (user_id) values (new.id) on conflict do nothing;
  insert into public.categories (user_id, name, emoji, color, sort) values
    (new.id, 'Учёба',       '📚', '#6C8EF5', 1),
    (new.id, 'Тренировки',  '💪', '#F2994A', 2),
    (new.id, 'Развивашки',  '🧩', '#56CCB2', 3),
    (new.id, 'Студия 12',   '✨', '#BB6BD9', 4),
    (new.id, 'Личное',      '🌿', '#9AA0A6', 5);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Доступ: каждый видит только свои данные
alter table public.settings   enable row level security;
alter table public.categories enable row level security;
alter table public.tasks      enable row level security;

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own categories" on public.categories;
create policy "own categories" on public.categories
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.settings, public.categories, public.tasks to authenticated;
revoke all on public.settings, public.categories, public.tasks from anon;

-- Синхронизация в реальном времени между устройствами
do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.categories;
exception when others then null; end $$;
