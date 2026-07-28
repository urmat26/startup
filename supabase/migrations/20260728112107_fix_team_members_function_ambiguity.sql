create or replace function public.get_team_members()
returns table(user_id uuid,full_name text,email text,role public.member_role,joined_at timestamptz,is_current boolean)
language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); actor_business_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required'; end if;
  select m.business_id into actor_business_id from public.memberships m where m.user_id=actor_id and m.role='owner' limit 1;
  if actor_business_id is null then raise exception 'Owner access required'; end if;
  return query select m.user_id,p.full_name,u.email,m.role,m.created_at,m.user_id=actor_id
    from public.memberships m join public.profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id
    where m.business_id=actor_business_id order by m.created_at;
end; $$;
