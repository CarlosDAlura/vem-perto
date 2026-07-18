-- Vem Perto: authorize before granting browser access.
begin;

create or replace function public.has_role(required_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles
    where profile_id = auth.uid() and role = required_role
  );
$$;

create or replace function public.is_store_owner(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.stores
    where id = target_store_id and owner_id = auth.uid()
  );
$$;

create or replace function public.can_access_order(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.orders o
    left join public.stores s on s.id = o.store_id
    left join public.delivery_assignments da on da.order_id = o.id
    left join public.couriers c on c.id = da.courier_id
    where o.id = target_order_id
      and (
        o.customer_id = auth.uid()
        or s.owner_id = auth.uid()
        or c.profile_id = auth.uid()
        or public.has_role('admin')
      )
  );
$$;

create or replace function public.can_view_financial(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.orders o
    join public.stores s on s.id = o.store_id
    left join public.delivery_assignments da on da.order_id = o.id
    left join public.couriers c on c.id = da.courier_id
    where o.id = target_order_id
      and (s.owner_id = auth.uid() or c.profile_id = auth.uid() or public.has_role('admin'))
  );
$$;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.platform_settings enable row level security;
alter table public.stores enable row level security;
alter table public.store_documents enable row level security;
alter table public.store_delivery_zones enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_option_groups enable row level security;
alter table public.product_option_items enable row level security;
alter table public.addresses enable row level security;
alter table public.couriers enable row level security;
alter table public.courier_documents enable row level security;
alter table public.coupons enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_financials enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.payments enable row level security;
alter table public.delivery_assignments enable row level security;
alter table public.order_status_history enable row level security;
alter table public.reviews enable row level security;
alter table public.order_messages enable row level security;
alter table public.notifications enable row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_transactions enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles: self or admin read" on public.profiles
  for select to authenticated using (id = auth.uid() or public.has_role('admin'));
create policy "roles: self or admin read" on public.user_roles
  for select to authenticated using (profile_id = auth.uid() or public.has_role('admin'));
create policy "settings: admin read" on public.platform_settings
  for select to authenticated using (public.has_role('admin'));

create policy "stores: public catalog or owner" on public.stores
  for select to anon, authenticated
  using (status = 'approved' or owner_id = auth.uid() or public.has_role('admin'));
create policy "store documents: owner or admin read" on public.store_documents
  for select to authenticated
  using (public.is_store_owner(store_id) or public.has_role('admin'));
create policy "delivery zones: public catalog or owner" on public.store_delivery_zones
  for select to anon, authenticated
  using (
    exists (select 1 from public.stores s where s.id = store_id and (s.status = 'approved' or s.owner_id = auth.uid() or public.has_role('admin')))
  );
create policy "categories: public read" on public.categories
  for select to anon, authenticated using (is_active or public.has_role('admin'));
create policy "products: public catalog or owner" on public.products
  for select to anon, authenticated
  using (
    exists (select 1 from public.stores s where s.id = store_id and (s.status = 'approved' or s.owner_id = auth.uid() or public.has_role('admin')))
  );
create policy "option groups: visible product" on public.product_option_groups
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.products p join public.stores s on s.id = p.store_id
      where p.id = product_id and (s.status = 'approved' or s.owner_id = auth.uid() or public.has_role('admin'))
    )
  );
create policy "option items: visible group" on public.product_option_items
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.product_option_groups g join public.products p on p.id = g.product_id join public.stores s on s.id = p.store_id
      where g.id = group_id and (s.status = 'approved' or s.owner_id = auth.uid() or public.has_role('admin'))
    )
  );

create policy "addresses: self read" on public.addresses
  for select to authenticated using (profile_id = auth.uid());
create policy "addresses: self insert" on public.addresses
  for insert to authenticated with check (profile_id = auth.uid());
create policy "addresses: self update" on public.addresses
  for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "addresses: self delete" on public.addresses
  for delete to authenticated using (profile_id = auth.uid());

create policy "couriers: self or admin read" on public.couriers
  for select to authenticated using (profile_id = auth.uid() or public.has_role('admin'));
create policy "courier docs: self or admin read" on public.courier_documents
  for select to authenticated
  using (exists (select 1 from public.couriers c where c.id = courier_id and c.profile_id = auth.uid()) or public.has_role('admin'));
create policy "coupons: active read" on public.coupons
  for select to anon, authenticated using (is_active or public.has_role('admin'));

create policy "orders: participant read" on public.orders
  for select to authenticated using (public.can_access_order(id));
create policy "items: participant read" on public.order_items
  for select to authenticated using (public.can_access_order(order_id));
create policy "financials: shop courier admin read" on public.order_financials
  for select to authenticated using (public.can_view_financial(order_id));
create policy "payments: customer store admin read" on public.payments
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o join public.stores s on s.id = o.store_id
      where o.id = order_id and (o.customer_id = auth.uid() or s.owner_id = auth.uid() or public.has_role('admin'))
    )
  );
create policy "assignments: participant read" on public.delivery_assignments
  for select to authenticated using (public.can_access_order(order_id));
create policy "history: participant read" on public.order_status_history
  for select to authenticated using (public.can_access_order(order_id));
create policy "redemptions: self or admin read" on public.coupon_redemptions
  for select to authenticated using (customer_id = auth.uid() or public.has_role('admin'));

create policy "reviews: public read" on public.reviews
  for select to anon, authenticated using (true);
create policy "messages: participant read" on public.order_messages
  for select to authenticated using (public.can_access_order(order_id));
create policy "notifications: self read" on public.notifications
  for select to authenticated using (profile_id = auth.uid());
create policy "loyalty: self read" on public.loyalty_accounts
  for select to authenticated using (profile_id = auth.uid());
create policy "loyalty history: self read" on public.loyalty_transactions
  for select to authenticated using (profile_id = auth.uid());
create policy "audit: admin read" on public.audit_logs
  for select to authenticated using (public.has_role('admin'));

-- Sensitive records have no direct browser write policy. Edge Functions perform those writes.
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.stores, public.store_delivery_zones, public.categories, public.products,
  public.product_option_groups, public.product_option_items, public.coupons, public.reviews to anon;
grant select on public.profiles, public.user_roles, public.platform_settings, public.stores, public.store_documents,
  public.store_delivery_zones, public.categories, public.products, public.product_option_groups,
  public.product_option_items, public.addresses, public.couriers, public.courier_documents, public.coupons,
  public.orders, public.order_items, public.order_financials, public.coupon_redemptions, public.payments,
  public.delivery_assignments, public.order_status_history, public.reviews, public.order_messages,
  public.notifications, public.loyalty_accounts, public.loyalty_transactions, public.audit_logs to authenticated;
grant insert, update, delete on public.addresses to authenticated;

-- Private document buckets. Files use `<profile_id>/<uuid>/filename` paths.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('merchant-documents', 'merchant-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png']),
  ('courier-documents', 'courier-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "documents: uploader insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('merchant-documents', 'courier-documents')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "documents: uploader read" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('merchant-documents', 'courier-documents')
    and ((storage.foldername(name))[1] = auth.uid()::text or public.has_role('admin'))
  );
create policy "documents: uploader delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('merchant-documents', 'courier-documents')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
