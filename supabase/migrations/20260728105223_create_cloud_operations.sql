create type public.stock_movement_type as enum ('sale', 'sale_cancel', 'receipt', 'writeoff', 'inventory');
create type public.inventory_status as enum ('draft', 'completed');

create table public.ingredients (
  id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9_-]+$'), name text not null check (char_length(trim(name)) between 1 and 100),
  unit text not null check (char_length(unit) between 1 and 12), stock numeric(14,3) not null default 0 check (stock >= 0),
  initial_stock numeric(14,3) not null default 0 check (initial_stock >= 0), threshold numeric(14,3) not null default 0 check (threshold >= 0),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (location_id, code), unique (id, location_id)
);
create table public.products (
  id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9_-]+$'), name text not null check (char_length(trim(name)) between 1 and 100), emoji text not null default '',
  price numeric(12,2) not null check (price >= 0), active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (location_id, code), unique (id, location_id)
);
create table public.product_recipes (
  location_id uuid not null references public.locations(id) on delete cascade, product_id uuid not null, ingredient_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0), primary key (product_id, ingredient_id),
  foreign key (product_id, location_id) references public.products(id, location_id) on delete cascade,
  foreign key (ingredient_id, location_id) references public.ingredients(id, location_id) on delete cascade
);
create table public.shifts (
  id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id) on delete cascade,
  opened_by uuid not null references auth.users(id), opened_at timestamptz not null default now(), closed_at timestamptz,
  check (closed_at is null or closed_at >= opened_at), unique (id, location_id)
);
create unique index shifts_one_open_per_location_idx on public.shifts(location_id) where closed_at is null;
create table public.sales (
  id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id) on delete cascade, shift_id uuid not null,
  product_id uuid, product_name text not null, unit_price numeric(12,2) not null check (unit_price >= 0), cogs numeric(12,2) not null check (cogs >= 0),
  recipe_snapshot jsonb not null check (jsonb_typeof(recipe_snapshot) = 'object'), sold_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  canceled_at timestamptz, canceled_by uuid references auth.users(id), foreign key (shift_id, location_id) references public.shifts(id, location_id),
  foreign key (product_id, location_id) references public.products(id, location_id)
);
create index sales_shift_created_idx on public.sales(shift_id, created_at);
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id) on delete cascade, shift_id uuid,
  ingredient_id uuid not null, type public.stock_movement_type not null, quantity numeric(14,3) not null check (quantity <> 0),
  note text not null default '' check (char_length(note) <= 160), source_id uuid, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  foreign key (shift_id, location_id) references public.shifts(id, location_id), foreign key (ingredient_id, location_id) references public.ingredients(id, location_id)
);
create index stock_movements_location_created_idx on public.stock_movements(location_id, created_at desc);
create index stock_movements_ingredient_idx on public.stock_movements(ingredient_id, created_at desc);
create table public.inventories (
  id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id) on delete cascade, shift_id uuid not null,
  status public.inventory_status not null default 'draft', created_by uuid not null references auth.users(id), started_at timestamptz not null default now(),
  completed_at timestamptz, total_shortage numeric(12,2) not null default 0 check (total_shortage >= 0),
  foreign key (shift_id, location_id) references public.shifts(id, location_id), unique (id, location_id)
);
create unique index inventories_one_draft_per_location_idx on public.inventories(location_id) where status = 'draft';
create table public.inventory_items (
  location_id uuid not null references public.locations(id) on delete cascade, inventory_id uuid not null, ingredient_id uuid not null,
  theoretical numeric(14,3) not null check (theoretical >= 0), actual numeric(14,3) check (actual >= 0), difference numeric(14,3),
  shortage_value numeric(12,2) not null default 0 check (shortage_value >= 0), overage_value numeric(12,2) not null default 0 check (overage_value >= 0),
  primary key (inventory_id, ingredient_id), foreign key (inventory_id, location_id) references public.inventories(id, location_id) on delete cascade,
  foreign key (ingredient_id, location_id) references public.ingredients(id, location_id)
);
create trigger ingredients_set_updated_at before update on public.ingredients for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();

create function public.is_location_member(target_location_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.locations l join public.memberships m on m.business_id=l.business_id where l.id=target_location_id and m.user_id=auth.uid());
$$;
create function public.is_location_owner(target_location_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.locations l join public.memberships m on m.business_id=l.business_id where l.id=target_location_id and m.user_id=auth.uid() and m.role='owner');
$$;
alter table public.ingredients enable row level security; alter table public.products enable row level security;
alter table public.product_recipes enable row level security; alter table public.shifts enable row level security;
alter table public.sales enable row level security; alter table public.stock_movements enable row level security;
alter table public.inventories enable row level security; alter table public.inventory_items enable row level security;
create policy "ingredients_select_member" on public.ingredients for select to authenticated using (public.is_location_member(location_id));
create policy "products_select_member" on public.products for select to authenticated using (public.is_location_member(location_id));
create policy "recipes_select_member" on public.product_recipes for select to authenticated using (public.is_location_member(location_id));
create policy "shifts_select_member" on public.shifts for select to authenticated using (public.is_location_member(location_id));
create policy "sales_select_member" on public.sales for select to authenticated using (public.is_location_member(location_id));
create policy "movements_select_member" on public.stock_movements for select to authenticated using (public.is_location_member(location_id));
create policy "inventories_select_member" on public.inventories for select to authenticated using (public.is_location_member(location_id));
create policy "inventory_items_select_member" on public.inventory_items for select to authenticated using (public.is_location_member(location_id));
revoke all on public.ingredients, public.products, public.product_recipes, public.shifts, public.sales, public.stock_movements, public.inventories, public.inventory_items from anon, authenticated;
grant select on public.ingredients, public.products, public.product_recipes, public.shifts, public.sales, public.stock_movements, public.inventories, public.inventory_items to authenticated;
revoke all on function public.is_location_member(uuid), public.is_location_owner(uuid) from public;
grant execute on function public.is_location_member(uuid), public.is_location_owner(uuid) to authenticated;
