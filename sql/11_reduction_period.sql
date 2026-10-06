begin;
alter table public.reductions add column if not exists days integer not null default 21 check (days between 1 and 365);
alter table public.reductions add column if not exists start_date date;
update public.reductions set start_date = created_at::date where start_date is null;
alter table public.reductions alter column start_date set default current_date;
alter table public.reductions alter column start_date set not null;
notify pgrst, 'reload schema';
commit;
