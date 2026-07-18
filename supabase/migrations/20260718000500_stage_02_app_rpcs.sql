-- Vem Perto: Stage 2 browser-safe application APIs.
begin;

create table if not exists public.store_favorites (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, store_id)
);

alter table public.store_favorites enable row level security;

create policy "favorites: own read" on public.store_favorites
  for select to authenticated using (profile_id = auth.uid());
create policy "favorites: own insert" on public.store_favorites
  for insert to authenticated with check (profile_id = auth.uid());
create policy "favorites: own delete" on public.store_favorites
  for delete to authenticated using (profile_id = auth.uid());

revoke all on public.store_favorites from anon, authenticated;
grant select, insert, delete on public.store_favorites to authenticated;

create or replace function public.submit_store_application(
  p_name text,
  p_category_label text,
  p_phone text,
  p_open_time time,
  p_close_time time,
  p_min_order_amount numeric,
  p_zones jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid := auth.uid();
  v_store_id uuid;
  v_slug_base text;
  v_zone jsonb;
begin
  if v_owner_id is null then
    raise exception 'Authentication is required';
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Store name is required';
  end if;
  if jsonb_typeof(p_zones) <> 'array' or jsonb_array_length(p_zones) = 0 then
    raise exception 'At least one delivery area is required';
  end if;
  if exists (
    select 1 from public.stores
    where owner_id = v_owner_id and status in ('pending', 'approved', 'suspended')
  ) then
    raise exception 'This account already has an active store application';
  end if;

  update public.profiles
  set phone = nullif(trim(p_phone), '')
  where id = v_owner_id;
  insert into public.user_roles(profile_id, role)
    values (v_owner_id, 'merchant')
    on conflict do nothing;

  v_slug_base := trim(both '-' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if v_slug_base = '' then v_slug_base := 'loja'; end if;

  insert into public.stores(
    owner_id, name, slug, category_label, status, is_accepting_orders,
    min_order_amount, open_time, close_time
  ) values (
    v_owner_id, trim(p_name), v_slug_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 7),
    nullif(trim(p_category_label), ''), 'pending', false,
    greatest(0, coalesce(p_min_order_amount, 0)), p_open_time, p_close_time
  ) returning id into v_store_id;

  for v_zone in select value from jsonb_array_elements(p_zones)
  loop
    if char_length(trim(coalesce(v_zone ->> 'name', ''))) < 2 then
      raise exception 'Each delivery area needs a name';
    end if;
    insert into public.store_delivery_zones(
      store_id, name, max_distance_km, base_delivery_fee, fee_per_km
    ) values (
      v_store_id,
      trim(v_zone ->> 'name'),
      greatest(0.1, coalesce((v_zone ->> 'max_distance_km')::numeric, 1)),
      greatest(0, coalesce((v_zone ->> 'base_delivery_fee')::numeric, 0)),
      greatest(0, coalesce((v_zone ->> 'fee_per_km')::numeric, 0))
    );
  end loop;

  insert into public.notifications(profile_id, type, title, body)
    select profile_id, 'store_application', 'Nova loja para aprovar', trim(p_name) || ' enviou um cadastro.'
    from public.user_roles where role = 'admin';
  insert into public.audit_logs(actor_id, action, entity_type, entity_id)
    values (v_owner_id, 'store.application_submitted', 'store', v_store_id);
  return v_store_id;
end;
$$;

create or replace function public.submit_courier_application(p_phone text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := auth.uid();
  v_courier_id uuid;
begin
  if v_profile_id is null then
    raise exception 'Authentication is required';
  end if;
  if exists (select 1 from public.couriers where profile_id = v_profile_id) then
    raise exception 'This account already has a courier application';
  end if;
  update public.profiles set phone = nullif(trim(p_phone), '') where id = v_profile_id;
  insert into public.user_roles(profile_id, role) values (v_profile_id, 'courier') on conflict do nothing;
  insert into public.couriers(profile_id, status, is_online)
    values (v_profile_id, 'pending', false)
    returning id into v_courier_id;
  insert into public.notifications(profile_id, type, title, body)
    select profile_id, 'courier_application', 'Novo motoboy para aprovar', 'Um motoboy enviou um cadastro.'
    from public.user_roles where role = 'admin';
  insert into public.audit_logs(actor_id, action, entity_type, entity_id)
    values (v_profile_id, 'courier.application_submitted', 'courier', v_courier_id);
  return v_courier_id;
end;
$$;

create or replace function public.register_store_document(
  p_store_id uuid, p_document_type text, p_storage_path text
)
returns uuid
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare v_document_id uuid;
begin
  if not public.is_store_owner(p_store_id) then raise exception 'Store owner role is required'; end if;
  if p_storage_path !~ ('^' || auth.uid()::text || '/') then raise exception 'Invalid document path'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'merchant-documents' and name = p_storage_path) then
    raise exception 'Document file was not found';
  end if;
  insert into public.store_documents(store_id, submitted_by, document_type, storage_path)
    values (p_store_id, auth.uid(), trim(p_document_type), p_storage_path)
    returning id into v_document_id;
  return v_document_id;
end;
$$;

create or replace function public.register_courier_document(
  p_courier_id uuid, p_document_type text, p_storage_path text
)
returns uuid
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
begin
  if not exists (select 1 from public.couriers where id = p_courier_id and profile_id = auth.uid()) then
    raise exception 'Courier profile is required';
  end if;
  if p_storage_path !~ ('^' || auth.uid()::text || '/') then raise exception 'Invalid document path'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'courier-documents' and name = p_storage_path) then
    raise exception 'Document file was not found';
  end if;
  insert into public.courier_documents(courier_id, submitted_by, document_type, storage_path)
    values (p_courier_id, auth.uid(), trim(p_document_type), p_storage_path);
  return p_courier_id;
end;
$$;

create or replace function public.update_owned_product(
  p_product_id uuid, p_price numeric, p_is_available boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.products p
  set price = greatest(0, p_price), is_available = p_is_available
  where p.id = p_product_id and public.is_store_owner(p.store_id);
  if not found then raise exception 'Product was not found for this store'; end if;
end;
$$;

create or replace function public.update_owned_store_operating_status(
  p_store_id uuid, p_is_accepting_orders boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.stores
  set is_accepting_orders = p_is_accepting_orders
  where id = p_store_id and owner_id = auth.uid() and status = 'approved';
  if not found then raise exception 'Approved store owner role is required'; end if;
end;
$$;

create or replace function public.send_order_message(
  p_order_id uuid, p_body text, p_message_type text default 'text', p_attachment_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_message_id uuid;
begin
  if not public.can_access_order(p_order_id) then raise exception 'Order participant role is required'; end if;
  if nullif(trim(coalesce(p_body, '')), '') is null and p_attachment_path is null then raise exception 'Message content is required'; end if;
  insert into public.order_messages(order_id, sender_id, message_type, body, attachment_path)
    values (p_order_id, auth.uid(), p_message_type, nullif(trim(p_body), ''), p_attachment_path)
    returning id into v_message_id;
  insert into public.notifications(profile_id, type, title, body, order_id)
    select profile_id, 'new_message', 'Nova mensagem', coalesce(nullif(trim(p_body), ''), 'Você recebeu um anexo.'), p_order_id
    from (
      select o.customer_id as profile_id from public.orders o where o.id = p_order_id
      union select s.owner_id from public.orders o join public.stores s on s.id = o.store_id where o.id = p_order_id
      union select c.profile_id from public.delivery_assignments da join public.couriers c on c.id = da.courier_id where da.order_id = p_order_id
    ) recipients
    where profile_id <> auth.uid();
  return v_message_id;
end;
$$;

create or replace function public.get_courier_delivery_offers()
returns table(
  order_id uuid, public_code text, store_id uuid, store_name text,
  delivery_neighborhood text, item_summary text, delivery_fee numeric,
  courier_net numeric, created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.id, o.public_code, s.id, s.name,
    coalesce(o.address_snapshot ->> 'neighborhood', 'Área de entrega'),
    coalesce(string_agg(oi.quantity::text || '× ' || oi.product_name_snapshot, ', ' order by oi.created_at), ''),
    o.delivery_fee, f.courier_net, o.created_at
  from public.orders o
  join public.stores s on s.id = o.store_id
  join public.order_financials f on f.order_id = o.id
  left join public.order_items oi on oi.order_id = o.id
  where o.status = 'awaiting_courier'
    and exists (select 1 from public.couriers c where c.profile_id = auth.uid() and c.status = 'approved' and c.is_online)
  group by o.id, s.id, f.courier_net;
$$;

create or replace function public.admin_set_profile_status(p_profile_id uuid, p_status public.approval_status)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role('admin') then raise exception 'Administrator role is required'; end if;
  update public.profiles set status = p_status where id = p_profile_id and id <> auth.uid();
  if not found then raise exception 'Profile was not found'; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'profile.status_updated', 'profile', p_profile_id, jsonb_build_object('status', p_status));
end;
$$;

create or replace function public.admin_upsert_coupon(
  p_code text, p_discount_type public.discount_type, p_amount numeric, p_min_order_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_coupon_id uuid;
begin
  if not public.has_role('admin') then raise exception 'Administrator role is required'; end if;
  insert into public.coupons(code, discount_type, amount, min_order_amount, created_by)
    values (upper(trim(p_code)), p_discount_type,
      case when p_discount_type = 'free_delivery' then 0 else greatest(0.01, p_amount) end,
      greatest(0, p_min_order_amount), auth.uid())
  on conflict (code) do update set
    discount_type = excluded.discount_type, amount = excluded.amount,
    min_order_amount = excluded.min_order_amount, is_active = true
  returning id into v_coupon_id;
  return v_coupon_id;
end;
$$;

create or replace function public.admin_replace_categories(p_names jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_name text; v_slug text;
begin
  if not public.has_role('admin') then raise exception 'Administrator role is required'; end if;
  if jsonb_typeof(p_names) <> 'array' then raise exception 'Categories must be an array'; end if;
  update public.categories set is_active = false;
  for v_name in select trim(value) from jsonb_array_elements_text(p_names) as items(value)
  loop
    if char_length(v_name) < 2 then continue; end if;
    v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
    if v_slug = '' then continue; end if;
    insert into public.categories(name, slug, is_active)
      values (v_name, v_slug, true)
      on conflict (name) do update set is_active = true;
  end loop;
end;
$$;

create or replace function public.admin_broadcast_notification(p_title text, p_body text, p_target_role public.app_role default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  if not public.has_role('admin') then raise exception 'Administrator role is required'; end if;
  insert into public.notifications(profile_id, type, title, body)
    select distinct p.id, 'platform_notice', trim(p_title), trim(p_body)
    from public.profiles p
    left join public.user_roles ur on ur.profile_id = p.id
    where p.status = 'approved' and (p_target_role is null or ur.role = p_target_role);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.submit_store_application(text, text, text, time, time, numeric, jsonb) from public, anon;
revoke execute on function public.submit_courier_application(text) from public, anon;
revoke execute on function public.register_store_document(uuid, text, text) from public, anon;
revoke execute on function public.register_courier_document(uuid, text, text) from public, anon;
revoke execute on function public.update_owned_product(uuid, numeric, boolean) from public, anon;
revoke execute on function public.update_owned_store_operating_status(uuid, boolean) from public, anon;
revoke execute on function public.send_order_message(uuid, text, text, text) from public, anon;
revoke execute on function public.get_courier_delivery_offers() from public, anon;
revoke execute on function public.admin_set_profile_status(uuid, public.approval_status) from public, anon;
revoke execute on function public.admin_upsert_coupon(text, public.discount_type, numeric, numeric) from public, anon;
revoke execute on function public.admin_replace_categories(jsonb) from public, anon;
revoke execute on function public.admin_broadcast_notification(text, text, public.app_role) from public, anon;

grant execute on function public.submit_store_application(text, text, text, time, time, numeric, jsonb) to authenticated;
grant execute on function public.submit_courier_application(text) to authenticated;
grant execute on function public.register_store_document(uuid, text, text) to authenticated;
grant execute on function public.register_courier_document(uuid, text, text) to authenticated;
grant execute on function public.update_owned_product(uuid, numeric, boolean) to authenticated;
grant execute on function public.update_owned_store_operating_status(uuid, boolean) to authenticated;
grant execute on function public.send_order_message(uuid, text, text, text) to authenticated;
grant execute on function public.get_courier_delivery_offers() to authenticated;
grant execute on function public.admin_set_profile_status(uuid, public.approval_status) to authenticated;
grant execute on function public.admin_upsert_coupon(text, public.discount_type, numeric, numeric) to authenticated;
grant execute on function public.admin_replace_categories(jsonb) to authenticated;
grant execute on function public.admin_broadcast_notification(text, text, public.app_role) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'store_favorites'
  ) then
    alter publication supabase_realtime add table public.store_favorites;
  end if;
end;
$$;

commit;
