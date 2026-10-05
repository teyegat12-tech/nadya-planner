-- ПЛАНЕР: обновление 2 — пауза/снятие задач + утренний план
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('todo', 'in_progress', 'paused', 'done', 'cancelled'));

alter table public.settings add column if not exists digest_time time default '08:30';
alter table public.settings add column if not exists last_digest_date date;

-- Журнал работы: кто (я / Claude / Codex), сколько времени, что сделано, где лежит
create table if not exists public.task_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  task_id uuid references public.tasks(id) on delete set null,
  author text not null default 'me',          -- me / claude / codex / любое имя агента
  minutes int not null default 0 check (minutes >= 0),
  summary text,                                -- что сделали
  location text,                               -- где лежит (папка, ссылка)
  result text not null default 'progress' check (result in ('done', 'needs_work', 'progress')),
  auto boolean not null default false,         -- запись создана таймером
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists task_logs_user_time_idx on public.task_logs (user_id, logged_at);
create index if not exists task_logs_task_idx on public.task_logs (task_id);

alter table public.task_logs enable row level security;
drop policy if exists "own logs" on public.task_logs;
create policy "own logs" on public.task_logs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.task_logs to authenticated;
revoke all on public.task_logs from anon;

-- Таймер: «В процессе» запускает отсчёт, смена статуса — записывает потраченное время
alter table public.tasks add column if not exists started_at timestamptz;
alter table public.settings add column if not exists report_time time default '21:00';
alter table public.settings add column if not exists last_report_date date;

create or replace function public.tasks_timer() returns trigger
language plpgsql security definer set search_path = public as $$
declare mins int;
begin
  if new.status = 'in_progress' and old.status is distinct from 'in_progress' then
    new.started_at := now();
  elsif old.status = 'in_progress' and new.status <> 'in_progress' and old.started_at is not null then
    mins := least(round(extract(epoch from now() - old.started_at) / 60), 720);
    if mins >= 1 then
      insert into public.task_logs (user_id, task_id, author, minutes, result, auto, summary)
      values (new.user_id, new.id, 'me', mins,
              case when new.status = 'done' then 'done' else 'progress' end, true, 'Таймер');
    end if;
    new.started_at := null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_timer on public.tasks;
create trigger tasks_timer before update of status on public.tasks
for each row execute function public.tasks_timer();

do $$ begin
  alter publication supabase_realtime add table public.task_logs;
exception when others then null; end $$;
