-- ПЛАНЕР: обновление 7 — несколько снов в день (ночной + дневной)
alter table public.sleep_log drop constraint if exists sleep_log_user_id_date_key;
create index if not exists sleep_user_date_idx on public.sleep_log (user_id, date);
