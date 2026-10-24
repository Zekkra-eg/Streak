-- Daily Duo Streak schema for Supabase
-- Run in Supabase Dashboard -> SQL Editor -> New query.
create extension if not exists pgcrypto;

create table if not exists public.duos (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Daily Duo',
  invite_code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.duo_members (
  id uuid primary key default gen_random_uuid(),
  duo_id uuid not null references public.duos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Bestie',
  created_at timestamptz not null default now(),
  unique (duo_id,user_id)
);

create table if not exists public.days (
  id uuid primary key default gen_random_uuid(),
  duo_id uuid not null references public.duos(id) on delete cascade,
  day_date date not null,
  created_at timestamptz not null default now(),
  unique (duo_id,day_date)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references public.days(id) on delete cascade,
  assigned_to text not null check (assigned_to in ('me','bestie','both')),
  title text not null,
  required boolean not null default true,
  done boolean not null default false,
  category text not null default 'Personal',
  created_at timestamptz not null default now()
);

create index if not exists duo_members_user_idx on public.duo_members(user_id);
create index if not exists days_duo_date_idx on public.days(duo_id,day_date desc);
create index if not exists tasks_day_idx on public.tasks(day_id);

-- Shared streak restore ledger: three uses per duo per calendar month.
create table if not exists public.duo_streak_restores (
  id uuid primary key default gen_random_uuid(),
  duo_id uuid not null references public.duos(id) on delete cascade,
  restored_date date not null,
  used_by uuid not null references auth.users(id) on delete cascade,
  used_at timestamptz not null default now(),
  unique (duo_id, restored_date)
);
create index if not exists duo_streak_restores_duo_used_idx on public.duo_streak_restores(duo_id, used_at desc);

create or replace function public.is_duo_member(target_duo uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.duo_members where duo_id=target_duo and user_id=auth.uid()); $$;

create or replace function public.is_day_member(target_day uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(
  select 1 from public.days d join public.duo_members m on m.duo_id=d.duo_id
  where d.id=target_day and m.user_id=auth.uid()
); $$;

create or replace function public.create_duo(duo_name text, invite_code_input text, display_name_input text)
returns public.duos language plpgsql security definer set search_path = public
as $$
declare new_duo public.duos;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if exists(select 1 from public.duo_members where user_id=auth.uid()) then
    raise exception 'You already belong to a duo. Sign in with a second account to join another.';
  end if;
  insert into public.duos(name,invite_code,created_by)
  values(coalesce(nullif(trim(duo_name),''),'Daily Duo'), upper(invite_code_input), auth.uid())
  returning * into new_duo;
  insert into public.duo_members(duo_id,user_id,display_name)
  values(new_duo.id,auth.uid(),coalesce(nullif(trim(display_name_input),''),'Me'));
  return new_duo;
end; $$;

create or replace function public.join_duo(invite_code_input text, display_name_input text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare target public.duos;
declare member_count int;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if exists(select 1 from public.duo_members where user_id=auth.uid()) then
    raise exception 'This account already belongs to a duo.';
  end if;
  select * into target from public.duos where invite_code=upper(trim(invite_code_input)) for update;
  if target.id is null then raise exception 'Invite code not found.'; end if;
  select count(*) into member_count from public.duo_members where duo_id=target.id;
  if member_count >= 2 then raise exception 'This duo already has two members.'; end if;
  insert into public.duo_members(duo_id,user_id,display_name)
  values(target.id,auth.uid(),coalesce(nullif(trim(display_name_input),''),'Bestie'));
  return target.id;
end; $$;

alter table public.duos enable row level security;
alter table public.duo_members enable row level security;
alter table public.days enable row level security;
alter table public.tasks enable row level security;
alter table public.duo_streak_restores enable row level security;

drop policy if exists "members can read their duo" on public.duos;
create policy "members can read their duo" on public.duos for select to authenticated using (public.is_duo_member(id));
drop policy if exists "members can read duo members" on public.duo_members;
create policy "members can read duo members" on public.duo_members for select to authenticated using (public.is_duo_member(duo_id));
drop policy if exists "members can update own display name" on public.duo_members;
create policy "members can update own display name" on public.duo_members for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
drop policy if exists "members can read days" on public.days;
create policy "members can read days" on public.days for select to authenticated using (public.is_duo_member(duo_id));
drop policy if exists "members can create days" on public.days;
create policy "members can create days" on public.days for insert to authenticated with check (public.is_duo_member(duo_id));
drop policy if exists "members can read duo restores" on public.duo_streak_restores;
create policy "members can read duo restores" on public.duo_streak_restores for select to authenticated using (public.is_duo_member(duo_id));
drop policy if exists "members can read tasks" on public.tasks;
create policy "members can read tasks" on public.tasks for select to authenticated using (public.is_day_member(day_id));
drop policy if exists "members can create tasks" on public.tasks;
create policy "members can create tasks" on public.tasks for insert to authenticated with check (public.is_day_member(day_id));
drop policy if exists "members can update tasks" on public.tasks;
create policy "members can update tasks" on public.tasks for update to authenticated using (public.is_day_member(day_id)) with check (public.is_day_member(day_id));
drop policy if exists "members can delete tasks" on public.tasks;
create policy "members can delete tasks" on public.tasks for delete to authenticated using (public.is_day_member(day_id));

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



grant execute on function public.create_duo(text,text,text) to authenticated;
grant execute on function public.join_duo(text,text) to authenticated;
grant execute on function public.restore_streak_day(date) to authenticated;
grant execute on function public.is_duo_member(uuid) to authenticated;
grant execute on function public.is_day_member(uuid) to authenticated;
grant select on public.duos, public.duo_members, public.days, public.tasks, public.duo_streak_restores to authenticated;
grant insert, update, delete on public.days, public.tasks to authenticated;
grant update on public.duo_members to authenticated;

-- Enable realtime updates for shared duo changes where Supabase Realtime is available.
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

