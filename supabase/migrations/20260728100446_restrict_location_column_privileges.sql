revoke insert, update on public.locations from authenticated;
grant insert (business_id, name) on public.locations to authenticated;
grant update (name) on public.locations to authenticated;
