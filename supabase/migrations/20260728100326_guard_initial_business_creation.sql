create or replace function public.create_business_with_owner(business_name text, location_name text)
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
  if exists (select 1 from public.memberships where user_id = owner_id) then
    raise exception 'User already has a business';
  end if;
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
