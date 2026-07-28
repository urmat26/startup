create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320), role public.member_role not null default 'barista', token_hash bytea not null unique,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), expires_at timestamptz not null default (now()+interval '7 days'),
  accepted_at timestamptz, accepted_by uuid references auth.users(id), check (role='barista'), check (expires_at>created_at)
);
create index staff_invitations_business_idx on public.staff_invitations(business_id,created_at desc);
create unique index staff_invitations_pending_email_idx on public.staff_invitations(business_id,lower(email)) where accepted_at is null;
alter table public.staff_invitations enable row level security;
revoke all on public.staff_invitations from anon,authenticated;

create function public.create_staff_invitation(invited_email text) returns text language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_business_id uuid; normalized text:=lower(trim(invited_email)); token text;
begin
 if actor is null then raise exception 'Authentication required'; end if; select business_id into actor_business_id from public.memberships where user_id=actor and role='owner' limit 1;
 if actor_business_id is null then raise exception 'Owner access required'; end if; if normalized !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'Invalid email'; end if;
 if exists(select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.business_id=actor_business_id and lower(u.email)=normalized) then raise exception 'User is already a team member'; end if;
 delete from public.staff_invitations where business_id=actor_business_id and lower(email)=normalized and accepted_at is null;
 token:=encode(extensions.gen_random_bytes(24),'hex'); insert into public.staff_invitations(business_id,email,token_hash,created_by) values(actor_business_id,normalized,extensions.digest(token,'sha256'),actor); return token;
end; $$;
create function public.accept_staff_invitation(invitation_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_email text; invitation public.staff_invitations%rowtype;
begin
 if actor is null then raise exception 'Authentication required'; end if; select email into actor_email from auth.users where id=actor;
 select * into invitation from public.staff_invitations where token_hash=extensions.digest(invitation_token,'sha256') for update;
 if not found or invitation.accepted_at is not null or invitation.expires_at<=now() then raise exception 'Invitation is invalid or expired'; end if;
 if lower(actor_email)<>lower(invitation.email) then raise exception 'Invitation belongs to another email'; end if;
 if exists(select 1 from public.memberships where user_id=actor) then raise exception 'User already belongs to a business'; end if;
 insert into public.memberships(business_id,user_id,role) values(invitation.business_id,actor,invitation.role);
 update public.staff_invitations set accepted_at=now(),accepted_by=actor where id=invitation.id; return invitation.business_id;
end; $$;
create function public.get_team_members() returns table(user_id uuid,full_name text,email text,role public.member_role,joined_at timestamptz,is_current boolean) language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_business_id uuid;
begin
 if actor is null then raise exception 'Authentication required'; end if; select business_id into actor_business_id from public.memberships where user_id=actor and role='owner' limit 1;
 if actor_business_id is null then raise exception 'Owner access required'; end if;
 return query select m.user_id,p.full_name,u.email,m.role,m.created_at,m.user_id=actor from public.memberships m join public.profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id where m.business_id=actor_business_id order by m.created_at;
end; $$;
create function public.remove_team_member(target_user_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_business_id uuid;
begin
 if actor is null then raise exception 'Authentication required'; end if; if target_user_id=actor then raise exception 'Owner cannot remove themselves'; end if;
 select business_id into actor_business_id from public.memberships where user_id=actor and role='owner' limit 1; if actor_business_id is null then raise exception 'Owner access required'; end if;
 if not exists(select 1 from public.memberships where business_id=actor_business_id and user_id=target_user_id and role='barista') then raise exception 'Barista not found'; end if;
 delete from public.memberships where business_id=actor_business_id and user_id=target_user_id;
end; $$;
revoke all on function public.create_staff_invitation(text),public.accept_staff_invitation(text),public.get_team_members(),public.remove_team_member(uuid) from public;
grant execute on function public.create_staff_invitation(text),public.accept_staff_invitation(text),public.get_team_members(),public.remove_team_member(uuid) to authenticated;
