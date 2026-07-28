create type public.member_role as enum ('owner', 'barista');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 100),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);

create table public.memberships (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create index memberships_user_id_idx on public.memberships(user_id);
create index locations_business_id_idx on public.locations(business_id);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger businesses_set_updated_at before update on public.businesses
for each row execute function public.set_updated_at();
create trigger locations_set_updated_at before update on public.locations
for each row execute function public.set_updated_at();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(trim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create function public.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships
    where business_id = target_business_id and user_id = auth.uid()
  );
$$;

create function public.is_business_owner(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships
    where business_id = target_business_id and user_id = auth.uid() and role = 'owner'
  );
$$;

create function public.create_business_with_owner(business_name text, location_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  new_business_id uuid;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if char_length(trim(business_name)) not between 2 and 100 then
    raise exception 'Business name must contain 2 to 100 characters';
  end if;
  if char_length(trim(location_name)) not between 2 and 100 then
    raise exception 'Location name must contain 2 to 100 characters';
  end if;

  insert into public.businesses (name, created_by)
  values (trim(business_name), owner_id)
  returning id into new_business_id;
  insert into public.memberships (business_id, user_id, role)
  values (new_business_id, owner_id, 'owner');
  insert into public.locations (business_id, name)
  values (new_business_id, trim(location_name));
  return new_business_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.locations enable row level security;
alter table public.memberships enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "businesses_select_member" on public.businesses for select to authenticated using (public.is_business_member(id));
create policy "businesses_update_owner" on public.businesses for update to authenticated using (public.is_business_owner(id)) with check (public.is_business_owner(id));
create policy "locations_select_member" on public.locations for select to authenticated using (public.is_business_member(business_id));
create policy "locations_insert_owner" on public.locations for insert to authenticated with check (public.is_business_owner(business_id));
create policy "locations_update_owner" on public.locations for update to authenticated using (public.is_business_owner(business_id)) with check (public.is_business_owner(business_id));
create policy "locations_delete_owner" on public.locations for delete to authenticated using (public.is_business_owner(business_id));
create policy "memberships_select_member" on public.memberships for select to authenticated using (public.is_business_member(business_id));

revoke all on public.profiles, public.businesses, public.locations, public.memberships from anon;
revoke all on public.profiles, public.businesses, public.locations, public.memberships from authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant select on public.businesses to authenticated;
grant update (name) on public.businesses to authenticated;
grant select, insert, update, delete on public.locations to authenticated;
grant select on public.memberships to authenticated;

revoke all on function public.is_business_member(uuid) from public;
revoke all on function public.is_business_owner(uuid) from public;
revoke all on function public.create_business_with_owner(text, text) from public;
grant execute on function public.is_business_member(uuid) to authenticated;
grant execute on function public.is_business_owner(uuid) to authenticated;
grant execute on function public.create_business_with_owner(text, text) to authenticated;
