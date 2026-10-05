-- ПЛАНЕР: обновление 6 — фото профиля (маленькая квадратная миниатюра)
alter table public.settings add column if not exists avatar text;
