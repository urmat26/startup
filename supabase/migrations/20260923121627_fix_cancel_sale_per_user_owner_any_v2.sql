create or replace function public.cancel_sale(target_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  sale_row public.sales%rowtype;
  recipe_row record;
begin
  if actor_id is null then raise exception 'Authentication required'; end if;
  select * into sale_row from public.sales where id = target_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if not public.is_location_member(sale_row.location_id) then raise exception 'Access denied'; end if;
  if sale_row.canceled_at is not null then raise exception 'Sale already canceled'; end if;
  if not exists (select 1 from public.shifts where id = sale_row.shift_id and closed_at is null) then
    raise exception 'Shift is closed';
  end if;
  if exists (select 1 from public.inventories where location_id = sale_row.location_id and status = 'draft') then
    raise exception 'Inventory in progress';
  end if;
  if sale_row.sold_by <> actor_id and not public.is_location_owner(sale_row.location_id) then
    raise exception 'Can only cancel own sale';
  end if;
  for recipe_row in select key::uuid as ingredient_id, value::numeric as quantity from jsonb_each_text(sale_row.recipe_snapshot) order by key loop
    perform 1 from public.ingredients where id = recipe_row.ingredient_id for update;
    update public.ingredients set stock = stock + recipe_row.quantity where id = recipe_row.ingredient_id;
    insert into public.stock_movements (location_id, shift_id, ingredient_id, type, quantity, note, source_id, created_by)
    values (sale_row.location_id, sale_row.shift_id, recipe_row.ingredient_id, 'sale_cancel', recipe_row.quantity, sale_row.product_name, sale_row.id, actor_id);
  end loop;
  update public.sales set canceled_at = now(), canceled_by = actor_id where id = sale_row.id;
end;
$$;
