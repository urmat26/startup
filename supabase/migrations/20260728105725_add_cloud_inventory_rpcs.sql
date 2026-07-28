create function public.start_inventory(target_location_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); shift_id uuid; inventory_id uuid:=gen_random_uuid();
begin
 if actor is null then raise exception 'Authentication required'; end if; if not public.is_location_owner(target_location_id) then raise exception 'Owner access required'; end if;
 select id into shift_id from public.shifts where location_id=target_location_id and closed_at is null for update; if shift_id is null then raise exception 'Open shift not found'; end if;
 if exists(select 1 from public.inventories where location_id=target_location_id and status='draft') then raise exception 'Inventory already in progress'; end if;
 insert into public.inventories(id,location_id,shift_id,created_by) values(inventory_id,target_location_id,shift_id,actor);
 insert into public.inventory_items(location_id,inventory_id,ingredient_id,theoretical) select target_location_id,inventory_id,id,stock from public.ingredients where location_id=target_location_id;
 return inventory_id;
end; $$;

create function public.complete_inventory(target_inventory_id uuid,actual_stock jsonb) returns numeric language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); inv public.inventories%rowtype; item record; actual_value numeric(14,3); difference_value numeric(14,3); shortage_value_calc numeric(12,2); overage_value_calc numeric(12,2); total_value numeric(12,2):=0; movement_delta numeric(14,3);
begin
 if actor is null then raise exception 'Authentication required'; end if; if jsonb_typeof(actual_stock)<>'object' then raise exception 'Actual stock must be an object'; end if;
 select * into inv from public.inventories where id=target_inventory_id for update; if not found or inv.status<>'draft' then raise exception 'Draft inventory not found'; end if;
 if not public.is_location_owner(inv.location_id) then raise exception 'Owner access required'; end if;
 if (select count(*) from jsonb_object_keys(actual_stock))<>(select count(*) from public.inventory_items where inventory_id=target_inventory_id) then raise exception 'Actual stock is incomplete'; end if;
 for item in select ii.ingredient_id,ii.theoretical,i.stock,i.unit_cost from public.inventory_items ii join public.ingredients i on i.id=ii.ingredient_id where ii.inventory_id=target_inventory_id order by ii.ingredient_id for update of i loop
  begin actual_value:=(actual_stock->>item.ingredient_id::text)::numeric; exception when others then raise exception 'Invalid actual stock'; end;
  if actual_value is null or actual_value<0 then raise exception 'Invalid actual stock'; end if; difference_value:=item.theoretical-actual_value;
  shortage_value_calc:=round(greatest(0,difference_value)*item.unit_cost,2); overage_value_calc:=round(greatest(0,-difference_value)*item.unit_cost,2); total_value:=total_value+shortage_value_calc; movement_delta:=actual_value-item.stock;
  update public.inventory_items set actual=actual_value,difference=difference_value,shortage_value=shortage_value_calc,overage_value=overage_value_calc where inventory_id=target_inventory_id and ingredient_id=item.ingredient_id;
  update public.ingredients set stock=actual_value where id=item.ingredient_id;
  if movement_delta<>0 then insert into public.stock_movements(location_id,shift_id,ingredient_id,type,quantity,note,source_id,created_by) values(inv.location_id,inv.shift_id,item.ingredient_id,'inventory',movement_delta,'Инвентаризация',target_inventory_id,actor); end if;
 end loop;
 update public.inventories set status='completed',completed_at=now(),total_shortage=round(total_value,2) where id=target_inventory_id;
 update public.shifts set closed_at=now() where id=inv.shift_id; insert into public.shifts(location_id,opened_by) values(inv.location_id,actor); return round(total_value,2);
end; $$;

create function public.cancel_inventory(target_inventory_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); inv public.inventories%rowtype;
begin
 if actor is null then raise exception 'Authentication required'; end if; select * into inv from public.inventories where id=target_inventory_id for update;
 if not found or inv.status<>'draft' then raise exception 'Draft inventory not found'; end if; if not public.is_location_owner(inv.location_id) then raise exception 'Owner access required'; end if;
 delete from public.inventories where id=target_inventory_id;
end; $$;
revoke all on function public.start_inventory(uuid),public.complete_inventory(uuid,jsonb),public.cancel_inventory(uuid) from public;
grant execute on function public.start_inventory(uuid),public.complete_inventory(uuid,jsonb),public.cancel_inventory(uuid) to authenticated;
