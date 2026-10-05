-- ПЛАНЕР: обновление 4 — категории с линейными иконками и новой палитрой
update public.categories set emoji = 'book',     color = '#9a7cfa' where emoji = '📚';
update public.categories set emoji = 'dumbbell', color = '#ff914d' where emoji = '💪';
update public.categories set emoji = 'puzzle',   color = '#5ccb8a' where emoji = '🧩';
update public.categories set emoji = 'sparkle',  color = '#fa7bae' where emoji = '✨';
update public.categories set emoji = 'leaf',     color = '#6c9ef5' where emoji = '🌿';

-- новые пользователи сразу получают иконки (на будущее)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.settings (user_id) values (new.id) on conflict do nothing;
  insert into public.categories (user_id, name, emoji, color, sort) values
    (new.id, 'Учёба',      'book',     '#9a7cfa', 1),
    (new.id, 'Тренировки', 'dumbbell', '#ff914d', 2),
    (new.id, 'Развивашки', 'puzzle',   '#5ccb8a', 3),
    (new.id, 'Студия 12',  'sparkle',  '#fa7bae', 4),
    (new.id, 'Личное',     'leaf',     '#6c9ef5', 5);
  return new;
end $$;
