create function public.initialize_location_catalog(target_location_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); milk uuid; beans uuid; cup uuid; syrup uuid; cocoa uuid; esp uuid; amer uuid; latte uuid; capp uuid; raf uuid; hot uuid;
begin
  if actor_id is null then select b.created_by into actor_id from public.locations l join public.businesses b on b.id=l.business_id where l.id=target_location_id;
  elsif not public.is_location_owner(target_location_id) then raise exception 'Owner access required'; end if;
  if actor_id is null then raise exception 'Location not found'; end if;
  if exists(select 1 from public.ingredients where location_id=target_location_id) or exists(select 1 from public.products where location_id=target_location_id) then return; end if;
  insert into public.ingredients(location_id,code,name,unit,stock,initial_stock,threshold,unit_cost) values(target_location_id,'milk','Молоко','мл',2500,2500,1500,.06) returning id into milk;
  insert into public.ingredients(location_id,code,name,unit,stock,initial_stock,threshold,unit_cost) values(target_location_id,'beans','Зёрна','г',1000,1000,300,1.5) returning id into beans;
  insert into public.ingredients(location_id,code,name,unit,stock,initial_stock,threshold,unit_cost) values(target_location_id,'cup','Стаканы','шт',200,200,50,4) returning id into cup;
  insert into public.ingredients(location_id,code,name,unit,stock,initial_stock,threshold,unit_cost) values(target_location_id,'syrup','Сироп','мл',1000,1000,250,.5) returning id into syrup;
  insert into public.ingredients(location_id,code,name,unit,stock,initial_stock,threshold,unit_cost) values(target_location_id,'cocoa','Какао','г',400,400,120,2.5) returning id into cocoa;
  insert into public.products(location_id,code,emoji,name,price) values(target_location_id,'esp','☕','Эспрессо',90) returning id into esp;
  insert into public.products(location_id,code,emoji,name,price) values(target_location_id,'amer','☕','Американо',110) returning id into amer;
  insert into public.products(location_id,code,emoji,name,price) values(target_location_id,'latte','🥛','Латте',160) returning id into latte;
  insert into public.products(location_id,code,emoji,name,price) values(target_location_id,'capp','☕','Капучино',150) returning id into capp;
  insert into public.products(location_id,code,emoji,name,price) values(target_location_id,'raf','🍮','Раф',190) returning id into raf;
  insert into public.products(location_id,code,emoji,name,price) values(target_location_id,'hot','🍫','Какао',140) returning id into hot;
  insert into public.product_recipes(location_id,product_id,ingredient_id,quantity) values
   (target_location_id,esp,beans,18),(target_location_id,esp,cup,1),(target_location_id,amer,beans,18),(target_location_id,amer,cup,1),
   (target_location_id,latte,beans,18),(target_location_id,latte,milk,200),(target_location_id,latte,cup,1),
   (target_location_id,capp,beans,18),(target_location_id,capp,milk,150),(target_location_id,capp,cup,1),
   (target_location_id,raf,beans,18),(target_location_id,raf,milk,150),(target_location_id,raf,syrup,20),(target_location_id,raf,cup,1),
   (target_location_id,hot,milk,200),(target_location_id,hot,cocoa,15),(target_location_id,hot,cup,1);
  insert into public.shifts(location_id,opened_by) values(target_location_id,actor_id) on conflict(location_id) where closed_at is null do nothing;
end; $$;

create function public.record_sale(target_product_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); p public.products%rowtype; shift_id uuid; sale_id uuid:=gen_random_uuid(); r record; recipe jsonb:='{}'; cogs numeric(12,2):=0;
begin
  if actor is null then raise exception 'Authentication required'; end if; select * into p from public.products where id=target_product_id and active;
  if not found then raise exception 'Product not found'; end if; if not public.is_location_member(p.location_id) then raise exception 'Access denied'; end if;
  if exists(select 1 from public.inventories where location_id=p.location_id and status='draft') then raise exception 'Inventory in progress'; end if;
  select id into shift_id from public.shifts where location_id=p.location_id and closed_at is null; if shift_id is null then raise exception 'Open shift not found'; end if;
  for r in select pr.ingredient_id,pr.quantity,i.stock,i.unit_cost,i.name from public.product_recipes pr join public.ingredients i on i.id=pr.ingredient_id where pr.product_id=p.id order by pr.ingredient_id for update of i loop
    if r.stock<r.quantity then raise exception 'Insufficient stock: %',r.name; end if; recipe:=recipe||jsonb_build_object(r.ingredient_id::text,r.quantity); cogs:=cogs+r.quantity*r.unit_cost;
  end loop;
  if recipe='{}'::jsonb then raise exception 'Product recipe is empty'; end if;
  insert into public.sales(id,location_id,shift_id,product_id,product_name,unit_price,cogs,recipe_snapshot,sold_by) values(sale_id,p.location_id,shift_id,p.id,p.name,p.price,round(cogs,2),recipe,actor);
  for r in select key::uuid ingredient_id,value::numeric quantity from jsonb_each_text(recipe) loop
    update public.ingredients set stock=stock-r.quantity where id=r.ingredient_id;
    insert into public.stock_movements(location_id,shift_id,ingredient_id,type,quantity,note,source_id,created_by) values(p.location_id,shift_id,r.ingredient_id,'sale',-r.quantity,p.name,sale_id,actor);
  end loop; return sale_id;
end; $$;

create function public.cancel_sale(target_sale_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); s public.sales%rowtype; r record;
begin
  if actor is null then raise exception 'Authentication required'; end if; select * into s from public.sales where id=target_sale_id for update;
  if not found then raise exception 'Sale not found'; end if; if not public.is_location_member(s.location_id) then raise exception 'Access denied'; end if;
  if s.canceled_at is not null then raise exception 'Sale already canceled'; end if; if not exists(select 1 from public.shifts where id=s.shift_id and closed_at is null) then raise exception 'Shift is closed'; end if;
  if exists(select 1 from public.inventories where location_id=s.location_id and status='draft') then raise exception 'Inventory in progress'; end if;
  for r in select key::uuid ingredient_id,value::numeric quantity from jsonb_each_text(s.recipe_snapshot) order by key loop
    perform 1 from public.ingredients where id=r.ingredient_id for update; update public.ingredients set stock=stock+r.quantity where id=r.ingredient_id;
    insert into public.stock_movements(location_id,shift_id,ingredient_id,type,quantity,note,source_id,created_by) values(s.location_id,s.shift_id,r.ingredient_id,'sale_cancel',r.quantity,s.product_name,s.id,actor);
  end loop; update public.sales set canceled_at=now(),canceled_by=actor where id=s.id;
end; $$;

create function public.adjust_stock(target_ingredient_id uuid,operation public.stock_movement_type,amount numeric,operation_note text default '') returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); i public.ingredients%rowtype; shift_id uuid; delta numeric(14,3);
begin
  if actor is null then raise exception 'Authentication required'; end if; if operation not in('receipt','writeoff') then raise exception 'Invalid stock operation'; end if;
  if amount is null or amount<=0 then raise exception 'Amount must be positive'; end if; if char_length(operation_note)>160 then raise exception 'Note is too long'; end if;
  select * into i from public.ingredients where id=target_ingredient_id for update; if not found then raise exception 'Ingredient not found'; end if;
  if not public.is_location_owner(i.location_id) then raise exception 'Owner access required'; end if;
  if exists(select 1 from public.inventories where location_id=i.location_id and status='draft') then raise exception 'Inventory in progress'; end if;
  select id into shift_id from public.shifts where location_id=i.location_id and closed_at is null; if shift_id is null then raise exception 'Open shift not found'; end if;
  delta:=case when operation='receipt' then amount else -amount end; if i.stock+delta<0 then raise exception 'Insufficient stock'; end if;
  update public.ingredients set stock=stock+delta where id=i.id; insert into public.stock_movements(location_id,shift_id,ingredient_id,type,quantity,note,created_by) values(i.location_id,shift_id,i.id,operation,delta,trim(operation_note),actor);
end; $$;

create or replace function public.create_business_with_owner(business_name text,location_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); new_business_id uuid; new_location_id uuid;
begin
 if owner_id is null then raise exception 'Authentication required'; end if; if exists(select 1 from public.memberships where user_id=owner_id) then raise exception 'User already has a business'; end if;
 if char_length(trim(business_name)) not between 2 and 100 then raise exception 'Business name must contain 2 to 100 characters'; end if;
 if char_length(trim(location_name)) not between 2 and 100 then raise exception 'Location name must contain 2 to 100 characters'; end if;
 insert into public.businesses(name,created_by) values(trim(business_name),owner_id) returning id into new_business_id;
 insert into public.memberships values(new_business_id,owner_id,'owner',now()); insert into public.locations(business_id,name) values(new_business_id,trim(location_name)) returning id into new_location_id;
 perform public.initialize_location_catalog(new_location_id); return new_business_id;
end; $$;
revoke all on function public.initialize_location_catalog(uuid),public.record_sale(uuid),public.cancel_sale(uuid),public.adjust_stock(uuid,public.stock_movement_type,numeric,text) from public;
grant execute on function public.initialize_location_catalog(uuid),public.record_sale(uuid),public.cancel_sale(uuid),public.adjust_stock(uuid,public.stock_movement_type,numeric,text) to authenticated;
do $$ declare l record; begin for l in select id from public.locations loop perform public.initialize_location_catalog(l.id); end loop; end $$;
