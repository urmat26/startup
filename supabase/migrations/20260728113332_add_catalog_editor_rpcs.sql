create function public.save_ingredient(target_location_id uuid,target_ingredient_id uuid,ingredient_code text,ingredient_name text,ingredient_unit text,opening_stock numeric,low_stock_threshold numeric,cost_per_unit numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid; normalized_code text:=lower(trim(ingredient_code));
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if; if not public.is_location_owner(target_location_id) then raise exception 'Owner access required'; end if;
 if exists(select 1 from public.inventories where location_id=target_location_id and status='draft') then raise exception 'Inventory in progress'; end if;
 if normalized_code !~ '^[a-z0-9_-]+$' then raise exception 'Invalid ingredient code'; end if; if char_length(trim(ingredient_name)) not between 1 and 100 then raise exception 'Invalid ingredient name'; end if;
 if char_length(trim(ingredient_unit)) not between 1 and 12 then raise exception 'Invalid unit'; end if;
 if opening_stock is null or opening_stock<0 or low_stock_threshold is null or low_stock_threshold<0 or cost_per_unit is null or cost_per_unit<0 then raise exception 'Values must be non-negative'; end if;
 if target_ingredient_id is null then
  insert into public.ingredients(location_id,code,name,unit,stock,initial_stock,threshold,unit_cost) values(target_location_id,normalized_code,trim(ingredient_name),trim(ingredient_unit),opening_stock,opening_stock,low_stock_threshold,cost_per_unit) returning id into result_id;
 else
  update public.ingredients set code=normalized_code,name=trim(ingredient_name),unit=trim(ingredient_unit),threshold=low_stock_threshold,unit_cost=cost_per_unit where id=target_ingredient_id and location_id=target_location_id returning id into result_id;
  if result_id is null then raise exception 'Ingredient not found'; end if;
 end if; return result_id;
end; $$;

create function public.save_product(target_location_id uuid,target_product_id uuid,product_code text,product_name text,product_emoji text,product_price numeric,recipe jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid; normalized_code text:=lower(trim(product_code)); recipe_row record; recipe_count integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if; if not public.is_location_owner(target_location_id) then raise exception 'Owner access required'; end if;
 if exists(select 1 from public.inventories where location_id=target_location_id and status='draft') then raise exception 'Inventory in progress'; end if;
 if normalized_code !~ '^[a-z0-9_-]+$' then raise exception 'Invalid product code'; end if; if char_length(trim(product_name)) not between 1 and 100 then raise exception 'Invalid product name'; end if;
 if product_price is null or product_price<0 then raise exception 'Invalid product price'; end if; if jsonb_typeof(recipe)<>'object' then raise exception 'Recipe must be an object'; end if;
 select count(*) into recipe_count from jsonb_object_keys(recipe); if recipe_count=0 then raise exception 'Recipe is empty'; end if;
 for recipe_row in select key,value from jsonb_each_text(recipe) loop
  if recipe_row.value::numeric<=0 then raise exception 'Recipe quantities must be positive'; end if;
  if not exists(select 1 from public.ingredients where id=recipe_row.key::uuid and location_id=target_location_id) then raise exception 'Recipe contains an invalid ingredient'; end if;
 end loop;
 if target_product_id is null then insert into public.products(location_id,code,name,emoji,price) values(target_location_id,normalized_code,trim(product_name),left(coalesce(product_emoji,''),12),product_price) returning id into result_id;
 else update public.products set code=normalized_code,name=trim(product_name),emoji=left(coalesce(product_emoji,''),12),price=product_price where id=target_product_id and location_id=target_location_id returning id into result_id;
  if result_id is null then raise exception 'Product not found'; end if; delete from public.product_recipes where product_id=result_id;
 end if;
 insert into public.product_recipes(location_id,product_id,ingredient_id,quantity) select target_location_id,result_id,key::uuid,value::numeric from jsonb_each_text(recipe); return result_id;
exception when invalid_text_representation then raise exception 'Recipe contains invalid values';
end; $$;

create function public.set_product_active(target_product_id uuid,enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare product_location_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if; select location_id into product_location_id from public.products where id=target_product_id;
 if product_location_id is null then raise exception 'Product not found'; end if; if not public.is_location_owner(product_location_id) then raise exception 'Owner access required'; end if;
 update public.products set active=enabled where id=target_product_id;
end; $$;
revoke all on function public.save_ingredient(uuid,uuid,text,text,text,numeric,numeric,numeric),public.save_product(uuid,uuid,text,text,text,numeric,jsonb),public.set_product_active(uuid,boolean) from public;
grant execute on function public.save_ingredient(uuid,uuid,text,text,text,numeric,numeric,numeric),public.save_product(uuid,uuid,text,text,text,numeric,jsonb),public.set_product_active(uuid,boolean) to authenticated;
