-- Vem Perto: schema central. Apply only to development first.
begin;

create extension if not exists pgcrypto;

create type public.app_role as enum ('customer', 'merchant', 'courier', 'admin');
create type public.approval_status as enum ('pending', 'approved', 'rejected', 'suspended');
create type public.order_status as enum (
  'created', 'awaiting_store_confirmation', 'accepted_by_store', 'rejected_by_store',
  'preparing', 'ready_for_pickup', 'awaiting_courier', 'courier_assigned',
  'courier_to_store', 'picked_up', 'on_the_way', 'delivered', 'cancelled'
);
create type public.discount_type as enum ('percent', 'fixed', 'free_delivery');
create type public.coupon_redemption_status as enum ('reserved', 'redeemed', 'released');
create type public.payment_status as enum ('pending', 'authorized', 'paid', 'failed', 'refunded', 'cancelled');
create type public.delivery_assignment_status as enum ('assigned', 'accepted', 'picked_up', 'delivered', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  phone text,
  avatar_path text,
  status public.approval_status not null default 'approved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (profile_id, role)
);

create table public.platform_settings (
  singleton boolean primary key default true check (singleton),
  platform_commission_rate numeric(5,4) not null default 0.1000 check (platform_commission_rate between 0 and 1),
  courier_delivery_share_rate numeric(5,4) not null default 0.7200 check (courier_delivery_share_rate between 0 and 1),
  currency text not null default 'BRL' check (currency = 'BRL'),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings(singleton) values (true);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  category_label text,
  status public.approval_status not null default 'pending',
  is_accepting_orders boolean not null default false,
  min_order_amount numeric(12,2) not null default 0 check (min_order_amount >= 0),
  open_time time,
  close_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.store_documents (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  document_type text not null,
  storage_path text not null unique,
  review_status public.approval_status not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.store_delivery_zones (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  max_distance_km numeric(6,2) check (max_distance_km > 0),
  base_delivery_fee numeric(12,2) not null default 0 check (base_delivery_fee >= 0),
  fee_per_km numeric(12,2) not null default 0 check (fee_per_km >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, name)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null check (char_length(trim(name)) between 2 and 180),
  description text,
  sku text,
  price numeric(12,2) not null check (price >= 0),
  is_available boolean not null default true,
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  prep_minutes integer not null default 20 check (prep_minutes between 0 and 720),
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, sku)
);

create table public.product_option_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  min_selections integer not null default 0 check (min_selections >= 0),
  max_selections integer not null default 1 check (max_selections >= min_selections),
  is_required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_option_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.product_option_groups(id) on delete cascade,
  name text not null,
  additional_price numeric(12,2) not null default 0 check (additional_price >= 0),
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'Casa',
  recipient_name text not null,
  phone text,
  postal_code text,
  street text not null,
  number text not null,
  complement text,
  neighborhood text,
  city text not null,
  state text not null,
  latitude numeric(10,7),
  longitude numeric(10,7),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index addresses_one_default_per_profile
  on public.addresses(profile_id) where is_default;

create table public.couriers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete restrict,
  status public.approval_status not null default 'pending',
  is_online boolean not null default false,
  rating numeric(3,2) not null default 0 check (rating between 0 and 5),
  delivery_count integer not null default 0 check (delivery_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.courier_documents (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references public.couriers(id) on delete cascade,
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  document_type text not null,
  storage_path text not null unique,
  review_status public.approval_status not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code) and code ~ '^[A-Z0-9_-]{3,40}$'),
  discount_type public.discount_type not null,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  min_order_amount numeric(12,2) not null default 0 check (min_order_amount >= 0),
  max_total_uses integer check (max_total_uses is null or max_total_uses > 0),
  max_uses_per_customer integer check (max_uses_per_customer is null or max_uses_per_customer > 0),
  usage_count integer not null default 0 check (usage_count >= 0),
  starts_at timestamptz,
  expires_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or starts_at is null or expires_at > starts_at),
  check ((discount_type = 'free_delivery' and amount = 0) or (discount_type <> 'free_delivery' and amount > 0))
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique default ('VP-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  customer_id uuid not null references public.profiles(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  delivery_zone_id uuid references public.store_delivery_zones(id) on delete set null,
  address_snapshot jsonb not null,
  status public.order_status not null default 'awaiting_store_confirmation',
  client_request_id uuid not null,
  prep_minutes integer check (prep_minutes is null or prep_minutes between 0 and 720),
  items_total numeric(12,2) not null default 0 check (items_total >= 0),
  delivery_fee numeric(12,2) not null default 0 check (delivery_fee >= 0),
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, client_request_id)
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name_snapshot text not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  additions_snapshot jsonb not null default '[]'::jsonb,
  additions_total numeric(12,2) not null default 0 check (additions_total >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create table public.order_financials (
  order_id uuid primary key references public.orders(id) on delete cascade,
  items_total numeric(12,2) not null check (items_total >= 0),
  delivery_fee numeric(12,2) not null check (delivery_fee >= 0),
  discount_total numeric(12,2) not null check (discount_total >= 0),
  total_paid numeric(12,2) not null check (total_paid >= 0),
  platform_commission numeric(12,2) not null check (platform_commission >= 0),
  shop_net numeric(12,2) not null check (shop_net >= 0),
  courier_net numeric(12,2) not null check (courier_net >= 0),
  platform_revenue numeric(12,2) not null check (platform_revenue >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  status public.coupon_redemption_status not null default 'reserved',
  discount_amount numeric(12,2) not null check (discount_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index coupon_redemptions_customer_coupon_idx on public.coupon_redemptions(customer_id, coupon_id, status);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  provider text,
  provider_reference text unique,
  status public.payment_status not null default 'pending',
  amount numeric(12,2) not null check (amount >= 0),
  payment_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.delivery_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  courier_id uuid not null references public.couriers(id) on delete restrict,
  status public.delivery_assignment_status not null default 'assigned',
  assigned_at timestamptz not null default now(),
  accepted_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  actor_id uuid references public.profiles(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  food_rating smallint not null check (food_rating between 1 and 5),
  delivery_rating smallint not null check (delivery_rating between 1 and 5),
  service_rating smallint not null check (service_rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create table public.order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  message_type text not null default 'text' check (message_type in ('text', 'image', 'location', 'system')),
  body text,
  attachment_path text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (body is not null or attachment_path is not null)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  order_id uuid references public.orders(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.loyalty_accounts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  points_balance integer not null default 0 check (points_balance >= 0),
  updated_at timestamptz not null default now()
);

create table public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  points_delta integer not null check (points_delta <> 0),
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index stores_owner_idx on public.stores(owner_id, status);
create index products_store_available_idx on public.products(store_id, is_available);
create index orders_customer_created_idx on public.orders(customer_id, created_at desc);
create index orders_store_status_created_idx on public.orders(store_id, status, created_at desc);
create index orders_status_created_idx on public.orders(status, created_at desc);
create index order_items_order_idx on public.order_items(order_id);
create index history_order_created_idx on public.order_status_history(order_id, created_at);
create index messages_order_created_idx on public.order_messages(order_id, created_at);
create index notifications_profile_unread_idx on public.notifications(profile_id, created_at desc) where read_at is null;
create index audit_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, 'Usuário'), '@', 1)),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), '')
  );
  insert into public.user_roles(profile_id, role) values (new.id, 'customer');
  insert into public.loyalty_accounts(profile_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute procedure public.handle_new_user();

create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger settings_set_updated_at before update on public.platform_settings for each row execute procedure public.set_updated_at();
create trigger stores_set_updated_at before update on public.stores for each row execute procedure public.set_updated_at();
create trigger zones_set_updated_at before update on public.store_delivery_zones for each row execute procedure public.set_updated_at();
create trigger categories_set_updated_at before update on public.categories for each row execute procedure public.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute procedure public.set_updated_at();
create trigger groups_set_updated_at before update on public.product_option_groups for each row execute procedure public.set_updated_at();
create trigger option_items_set_updated_at before update on public.product_option_items for each row execute procedure public.set_updated_at();
create trigger addresses_set_updated_at before update on public.addresses for each row execute procedure public.set_updated_at();
create trigger couriers_set_updated_at before update on public.couriers for each row execute procedure public.set_updated_at();
create trigger coupons_set_updated_at before update on public.coupons for each row execute procedure public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders for each row execute procedure public.set_updated_at();
create trigger financials_set_updated_at before update on public.order_financials for each row execute procedure public.set_updated_at();
create trigger redemptions_set_updated_at before update on public.coupon_redemptions for each row execute procedure public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments for each row execute procedure public.set_updated_at();
create trigger assignments_set_updated_at before update on public.delivery_assignments for each row execute procedure public.set_updated_at();
create trigger loyalty_set_updated_at before update on public.loyalty_accounts for each row execute procedure public.set_updated_at();

commit;
