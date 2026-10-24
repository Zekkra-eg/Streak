-- Run this migration in Supabase SQL Editor for an EXISTING Daily Duo Streak project.
-- It adds a shared monthly restore quota and a secure RPC to restore one past day.

create table if not exists public.duo_streak_restores (
  id uuid primary key default gen_random_uuid(),
  duo_id uuid not null references public.duos(id) on delete cascade,
  restored_date date not null,
  used_by uuid not null references auth.users(id) on delete cascade,
  used_at timestamptz not null default now(),
  unique (duo_id, restored_date)
);

create index if not exists duo_streak_restores_duo_used_idx
  on public.duo_streak_restores(duo_id, used_at desc);

alter table public.duo_streak_restores enable row level security;

drop policy if exists "members can read duo restores" on public.duo_streak_restores;
create policy "members can read duo restores"
  on public.duo_streak_restores for select to authenticated
  using (public.is_duo_member(duo_id));

grant select on public.duo_streak_restores to authenticated;

create or replace function public.restore_streak_day(target_date date)
returns public.duo_streak_restores
language plpgsql
security definer
set search_path = public
as $$
declare
  member_duo uuid;
  restore_count integer;
  target_day_id uuid;
  required_count integer := 0;
  done_count integer := 0;
  new_restore public.duo_streak_restores;
  cairo_today date := (now() at time zone 'Africa/Cairo')::date;
  cairo_month timestamp := date_trunc('month', now() at time zone 'Africa/Cairo');
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to restore a day.';
  end if;

  select dm.duo_id into member_duo
  from public.duo_members dm
  where dm.user_id = auth.uid()
  limit 1;

  if member_duo is null then
    raise exception 'Join a duo before using a streak restore.';
  end if;

  if target_date >= cairo_today then
    raise exception 'Only a past day can be restored.';
  end if;

  -- Serialize quota checks for the duo so both members cannot spend the last restore at once.
  perform 1 from public.duos where id = member_duo for update;

  select count(*) into restore_count
  from public.duo_streak_restores r
  where r.duo_id = member_duo
    and date_trunc('month', r.used_at at time zone 'Africa/Cairo') = cairo_month;

  if restore_count >= 3 then
    raise exception 'Your duo has already used all 3 restores for this month.';
  end if;

  if exists (
    select 1 from public.duo_streak_restores r
    where r.duo_id = member_duo and r.restored_date = target_date
  ) then
    raise exception 'This day has already been restored.';
  end if;

  select d.id into target_day_id
  from public.days d
  where d.duo_id = member_duo and d.day_date = target_date
  for update;

  if target_day_id is not null then
    select count(*) into required_count
    from public.tasks t where t.day_id = target_day_id and t.required = true;

    select count(*) into done_count
    from public.tasks t where t.day_id = target_day_id and t.required = true and t.done = true;

    if required_count > 0 and done_count = required_count then
      raise exception 'This day is already complete; it does not need a restore.';
    end if;
  else
    insert into public.days(duo_id, day_date)
    values (member_duo, target_date)
    on conflict (duo_id, day_date) do nothing
    returning id into target_day_id;

    if target_day_id is null then
      select d.id into target_day_id from public.days d
      where d.duo_id = member_duo and d.day_date = target_date;
    end if;
  end if;

  insert into public.duo_streak_restores(duo_id, restored_date, used_by)
  values (member_duo, target_date, auth.uid())
  returning * into new_restore;

  return new_restore;
end;
$$;

grant execute on function public.restore_streak_day(date) to authenticated;

-- Add shared task/day/restore events to Supabase Realtime if the publication exists.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='days') then
      alter publication supabase_realtime add table public.days;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='tasks') then
      alter publication supabase_realtime add table public.tasks;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='duo_streak_restores') then
      alter publication supabase_realtime add table public.duo_streak_restores;
    end if;
  end if;
end $$;
