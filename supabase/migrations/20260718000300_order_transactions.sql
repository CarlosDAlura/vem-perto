-- Vem Perto: all sensitive order writes are atomic PostgreSQL functions.
begin;

create or replace function public.create_order(
  p_store_id uuid,
  p_address_id uuid,
  p_delivery_zone_id uuid,
  p_items jsonb,
  p_client_request_id uuid,
  p_coupon_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_customer_id uuid := auth.uid();
  v_existing_order_id uuid;
  v_store public.stores%rowtype;
  v_address public.addresses%rowtype;
  v_zone public.store_delivery_zones%rowtype;
  v_product public.products%rowtype;
  v_coupon public.coupons%rowtype;
  v_settings public.platform_settings%rowtype;
  v_item jsonb;
  v_option jsonb;
  v_product_id uuid;
  v_option_item_id uuid;
  v_quantity integer;
  v_additions jsonb;
  v_additions_total numeric(12,2);
  v_line_total numeric(12,2);
  v_items_total numeric(12,2) := 0;
  v_delivery_fee numeric(12,2) := 0;
  v_discount_total numeric(12,2) := 0;
  v_total numeric(12,2);
  v_order_id uuid;
  v_coupon_id uuid;
  v_coupon_uses integer;
begin
  if v_customer_id is null then
    raise exception 'Authentication is required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'An order must contain at least one item';
  end if;

  select id into v_existing_order_id
  from public.orders
  where customer_id = v_customer_id and client_request_id = p_client_request_id;
  if v_existing_order_id is not null then
    return v_existing_order_id;
  end if;

  select * into v_store from public.stores where id = p_store_id for share;
  if not found or v_store.status <> 'approved' or not v_store.is_accepting_orders then
    raise exception 'Store is not accepting orders';
  end if;

  select * into v_address from public.addresses
  where id = p_address_id and profile_id = v_customer_id;
  if not found then
    raise exception 'Address was not found';
  end if;

  select * into v_zone from public.store_delivery_zones
  where id = p_delivery_zone_id and store_id = p_store_id and is_active = true;
  if not found then
    raise exception 'Delivery zone is not available for this store';
  end if;
  v_delivery_fee := v_zone.base_delivery_fee;

  create temporary table if not exists order_draft_items (
    product_id uuid,
    product_name text,
    unit_price numeric(12,2),
    quantity integer,
    additions jsonb,
    additions_total numeric(12,2),
    line_total numeric(12,2)
  ) on commit drop;
  truncate pg_temp.order_draft_items;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_quantity := coalesce((v_item ->> 'quantity')::integer, 0);
    if v_quantity < 1 or v_quantity > 99 then
      raise exception 'Invalid product quantity';
    end if;

    select * into v_product from public.products
    where id = v_product_id and store_id = p_store_id
    for update;
    if not found or not v_product.is_available then
      raise exception 'Product % is not available', v_product_id;
    end if;
    if v_product.stock_quantity is not null and v_product.stock_quantity < v_quantity then
      raise exception 'Insufficient stock for product %', v_product_id;
    end if;

    v_additions := '[]'::jsonb;
    v_additions_total := 0;
    for v_option in select value from jsonb_array_elements(coalesce(v_item -> 'option_item_ids', '[]'::jsonb))
    loop
      v_option_item_id := (v_option #>> '{}')::uuid;
      select jsonb_build_object('id', oi.id, 'name', oi.name, 'price', oi.additional_price)
      into v_option
      from public.product_option_items oi
      join public.product_option_groups og on og.id = oi.group_id
      where oi.id = v_option_item_id and og.product_id = v_product.id and oi.is_available = true
      for share;
      if v_option is null then
        raise exception 'Invalid or unavailable product option';
      end if;
      v_additions := v_additions || jsonb_build_array(v_option);
      v_additions_total := v_additions_total + (v_option ->> 'price')::numeric;
    end loop;

    v_line_total := round((v_product.price + v_additions_total) * v_quantity, 2);
    insert into pg_temp.order_draft_items
      values (v_product.id, v_product.name, v_product.price, v_quantity, v_additions, v_additions_total, v_line_total);
    v_items_total := v_items_total + v_line_total;
  end loop;

  if v_items_total < v_store.min_order_amount then
    raise exception 'Order does not meet store minimum amount';
  end if;

  if nullif(trim(coalesce(p_coupon_code, '')), '') is not null then
    select * into v_coupon from public.coupons
    where code = upper(trim(p_coupon_code))
    for update;
    if not found or not v_coupon.is_active
      or (v_coupon.starts_at is not null and v_coupon.starts_at > now())
      or (v_coupon.expires_at is not null and v_coupon.expires_at <= now())
      or v_items_total < v_coupon.min_order_amount
      or (v_coupon.max_total_uses is not null and v_coupon.usage_count >= v_coupon.max_total_uses) then
      raise exception 'Coupon is not valid';
    end if;

    select count(*) into v_coupon_uses
    from public.coupon_redemptions
    where coupon_id = v_coupon.id and customer_id = v_customer_id and status in ('reserved', 'redeemed');
    if v_coupon.max_uses_per_customer is not null and v_coupon_uses >= v_coupon.max_uses_per_customer then
      raise exception 'Coupon has already reached the customer limit';
    end if;

    v_coupon_id := v_coupon.id;
    if v_coupon.discount_type = 'percent' then
      v_discount_total := round(v_items_total * v_coupon.amount / 100, 2);
    elsif v_coupon.discount_type = 'fixed' then
      v_discount_total := least(v_coupon.amount, v_items_total);
    else
      v_discount_total := v_delivery_fee;
    end if;
  end if;

  v_total := greatest(0, round(v_items_total + v_delivery_fee - v_discount_total, 2));
  select * into v_settings from public.platform_settings where singleton = true for share;

  insert into public.orders (
    customer_id, store_id, delivery_zone_id, address_snapshot, client_request_id,
    items_total, delivery_fee, discount_total, total_amount
  ) values (
    v_customer_id, p_store_id, p_delivery_zone_id,
    jsonb_build_object('id', v_address.id, 'recipient_name', v_address.recipient_name, 'phone', v_address.phone,
      'street', v_address.street, 'number', v_address.number, 'complement', v_address.complement,
      'neighborhood', v_address.neighborhood, 'city', v_address.city, 'state', v_address.state,
      'postal_code', v_address.postal_code, 'latitude', v_address.latitude, 'longitude', v_address.longitude),
    p_client_request_id, v_items_total, v_delivery_fee, v_discount_total, v_total
  ) returning id into v_order_id;

  insert into public.order_items(order_id, product_id, product_name_snapshot, unit_price, quantity, additions_snapshot, additions_total, line_total)
  select v_order_id, product_id, product_name, unit_price, quantity, additions, additions_total, line_total
  from pg_temp.order_draft_items;

  update public.products p
  set stock_quantity = p.stock_quantity - d.quantity
  from pg_temp.order_draft_items d
  where p.id = d.product_id and p.stock_quantity is not null;

  insert into public.order_financials(
    order_id, items_total, delivery_fee, discount_total, total_paid, platform_commission, shop_net, courier_net, platform_revenue
  ) values (
    v_order_id, v_items_total, v_delivery_fee, v_discount_total, v_total,
    round(v_items_total * v_settings.platform_commission_rate, 2),
    greatest(0, round(v_items_total - (v_items_total * v_settings.platform_commission_rate), 2)),
    round(v_delivery_fee * v_settings.courier_delivery_share_rate, 2),
    round((v_items_total * v_settings.platform_commission_rate) + v_delivery_fee - (v_delivery_fee * v_settings.courier_delivery_share_rate), 2)
  );

  if v_coupon_id is not null then
    insert into public.coupon_redemptions(coupon_id, order_id, customer_id, discount_amount)
      values (v_coupon_id, v_order_id, v_customer_id, v_discount_total);
    update public.coupons set usage_count = usage_count + 1 where id = v_coupon_id;
  end if;

  insert into public.order_status_history(order_id, to_status, actor_id, details)
    values (v_order_id, 'awaiting_store_confirmation', v_customer_id, jsonb_build_object('source', 'create_order'));
  insert into public.notifications(profile_id, type, title, body, order_id)
    values (v_store.owner_id, 'new_order', 'Novo pedido', 'Pedido aguardando confirmação da loja.', v_order_id);
  insert into public.audit_logs(actor_id, action, entity_type, entity_id)
    values (v_customer_id, 'order.created', 'order', v_order_id);

  return v_order_id;
end;
$$;

create or replace function public.assign_courier(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_courier public.couriers%rowtype;
begin
  if v_actor_id is null then raise exception 'Authentication is required'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'awaiting_courier' then raise exception 'Order is not available for courier assignment'; end if;
  select * into v_courier from public.couriers where profile_id = v_actor_id for update;
  if not found or v_courier.status <> 'approved' or not v_courier.is_online then raise exception 'Courier is not available'; end if;

  insert into public.delivery_assignments(order_id, courier_id, status, assigned_at, accepted_at)
    values (v_order.id, v_courier.id, 'accepted', now(), now());
  update public.orders set status = 'courier_assigned', version = version + 1 where id = v_order.id;
  insert into public.order_status_history(order_id, from_status, to_status, actor_id)
    values (v_order.id, 'awaiting_courier', 'courier_assigned', v_actor_id);
  insert into public.notifications(profile_id, type, title, body, order_id)
    select profile_id, 'courier_assigned', 'Motoboy atribuído', 'Um motoboy assumiu a entrega.', v_order.id
    from (
      select v_order.customer_id as profile_id
      union select s.owner_id from public.stores s where s.id = v_order.store_id
      union select v_actor_id
    ) recipients;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id)
    values (v_actor_id, 'order.courier_assigned', 'order', v_order.id);
end;
$$;

create or replace function public.transition_order(
  p_order_id uuid,
  p_next_status public.order_status,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_is_owner boolean;
  v_is_admin boolean;
  v_is_assigned_courier boolean;
  v_previous_status public.order_status;
  v_points integer;
begin
  if v_actor_id is null then raise exception 'Authentication is required'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order was not found'; end if;
  v_previous_status := v_order.status;
  v_is_owner := public.is_store_owner(v_order.store_id);
  v_is_admin := public.has_role('admin');
  v_is_assigned_courier := exists (
    select 1 from public.delivery_assignments da join public.couriers c on c.id = da.courier_id
    where da.order_id = v_order.id and c.profile_id = v_actor_id
  );

  if v_previous_status in ('delivered', 'cancelled', 'rejected_by_store') then
    raise exception 'Order is final and cannot change status';
  end if;

  if p_next_status = 'cancelled' then
    if not (v_is_admin or (v_order.customer_id = v_actor_id and v_previous_status = 'awaiting_store_confirmation')) then
      raise exception 'Cancellation is not allowed';
    end if;
  elsif v_previous_status = 'awaiting_store_confirmation' then
    if not v_is_owner or p_next_status not in ('accepted_by_store', 'rejected_by_store') then raise exception 'Invalid store transition'; end if;
  elsif v_previous_status = 'accepted_by_store' then
    if not v_is_owner or p_next_status <> 'preparing' then raise exception 'Invalid store transition'; end if;
  elsif v_previous_status = 'preparing' then
    if not v_is_owner or p_next_status <> 'ready_for_pickup' then raise exception 'Invalid store transition'; end if;
  elsif v_previous_status = 'ready_for_pickup' then
    if not v_is_owner or p_next_status <> 'awaiting_courier' then raise exception 'Invalid store transition'; end if;
  elsif v_previous_status = 'courier_assigned' then
    if not v_is_assigned_courier or p_next_status <> 'courier_to_store' then raise exception 'Invalid courier transition'; end if;
  elsif v_previous_status = 'courier_to_store' then
    if not v_is_assigned_courier or p_next_status <> 'picked_up' then raise exception 'Invalid courier transition'; end if;
  elsif v_previous_status = 'picked_up' then
    if not v_is_assigned_courier or p_next_status <> 'on_the_way' then raise exception 'Invalid courier transition'; end if;
  elsif v_previous_status = 'on_the_way' then
    if not v_is_assigned_courier or p_next_status <> 'delivered' then raise exception 'Invalid courier transition'; end if;
  else
    raise exception 'Invalid order status sequence';
  end if;

  if p_next_status = 'accepted_by_store' then
    update public.orders set prep_minutes = greatest(0, least(720, coalesce((p_details ->> 'prep_minutes')::integer, 20))) where id = v_order.id;
  end if;
  update public.orders set status = p_next_status, version = version + 1 where id = v_order.id;

  if p_next_status in ('cancelled', 'rejected_by_store') then
    update public.products p set stock_quantity = p.stock_quantity + oi.quantity
      from public.order_items oi where oi.order_id = v_order.id and p.id = oi.product_id and p.stock_quantity is not null;
    update public.coupons c set usage_count = greatest(0, usage_count - 1)
      from public.coupon_redemptions cr where cr.order_id = v_order.id and cr.coupon_id = c.id and cr.status = 'reserved';
    update public.coupon_redemptions set status = 'released' where order_id = v_order.id and status = 'reserved';
  end if;

  if p_next_status = 'courier_to_store' then
    update public.delivery_assignments set status = 'accepted', accepted_at = now() where order_id = v_order.id;
  elsif p_next_status = 'picked_up' then
    update public.delivery_assignments set status = 'picked_up', picked_up_at = now() where order_id = v_order.id;
  elsif p_next_status = 'delivered' then
    update public.delivery_assignments set status = 'delivered', delivered_at = now() where order_id = v_order.id;
    update public.couriers c set delivery_count = delivery_count + 1
      from public.delivery_assignments da where da.order_id = v_order.id and da.courier_id = c.id;
    select floor(total_amount)::integer into v_points from public.orders where id = v_order.id;
    update public.loyalty_accounts set points_balance = points_balance + v_points where profile_id = v_order.customer_id;
    insert into public.loyalty_transactions(profile_id, order_id, points_delta, reason)
      values (v_order.customer_id, v_order.id, v_points, 'completed_order');
  end if;

  insert into public.order_status_history(order_id, from_status, to_status, actor_id, details)
    values (v_order.id, v_previous_status, p_next_status, v_actor_id, coalesce(p_details, '{}'::jsonb));
  insert into public.notifications(profile_id, type, title, body, order_id)
    select profile_id, 'order_status', 'Pedido atualizado', 'Novo status: ' || replace(p_next_status::text, '_', ' ') || '.', v_order.id
    from (
      select v_order.customer_id as profile_id
      union select s.owner_id from public.stores s where s.id = v_order.store_id
      union select c.profile_id from public.delivery_assignments da join public.couriers c on c.id = da.courier_id where da.order_id = v_order.id
    ) recipients;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
    values (v_actor_id, 'order.transition', 'order', v_order.id, jsonb_build_object('from', v_previous_status, 'to', p_next_status));
end;
$$;

create or replace function public.set_courier_online(p_online boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.couriers set is_online = p_online
  where profile_id = auth.uid() and status = 'approved';
  if not found then raise exception 'Approved courier profile is required'; end if;
end;
$$;

create or replace function public.review_store_order(
  p_order_id uuid, p_food_rating smallint, p_delivery_rating smallint, p_service_rating smallint, p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for share;
  if not found or v_order.customer_id <> auth.uid() or v_order.status <> 'delivered' then
    raise exception 'Review is not allowed';
  end if;
  insert into public.reviews(order_id, customer_id, store_id, food_rating, delivery_rating, service_rating, comment)
    values (v_order.id, auth.uid(), v_order.store_id, p_food_rating, p_delivery_rating, p_service_rating, nullif(trim(p_comment), ''));
end;
$$;

create or replace function public.review_store_application(p_store_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.has_role('admin') then raise exception 'Administrator role is required'; end if;
  update public.stores set status = case when p_approve then 'approved' else 'rejected' end,
    is_accepting_orders = case when p_approve then is_accepting_orders else false end
  where id = p_store_id and status = 'pending';
  if not found then raise exception 'Pending store was not found'; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'store.reviewed', 'store', p_store_id, jsonb_build_object('approved', p_approve, 'reason', p_reason));
end;
$$;

create or replace function public.review_courier_application(p_courier_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.has_role('admin') then raise exception 'Administrator role is required'; end if;
  update public.couriers set status = case when p_approve then 'approved' else 'rejected' end,
    is_online = false
  where id = p_courier_id and status = 'pending';
  if not found then raise exception 'Pending courier was not found'; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'courier.reviewed', 'courier', p_courier_id, jsonb_build_object('approved', p_approve, 'reason', p_reason));
end;
$$;

revoke execute on function public.create_order(uuid, uuid, uuid, jsonb, uuid, text) from public, anon;
revoke execute on function public.assign_courier(uuid) from public, anon;
revoke execute on function public.transition_order(uuid, public.order_status, jsonb) from public, anon;
revoke execute on function public.set_courier_online(boolean) from public, anon;
revoke execute on function public.review_store_order(uuid, smallint, smallint, smallint, text) from public, anon;
revoke execute on function public.review_store_application(uuid, boolean, text) from public, anon;
revoke execute on function public.review_courier_application(uuid, boolean, text) from public, anon;
grant execute on function public.create_order(uuid, uuid, uuid, jsonb, uuid, text) to authenticated;
grant execute on function public.assign_courier(uuid) to authenticated;
grant execute on function public.transition_order(uuid, public.order_status, jsonb) to authenticated;
grant execute on function public.set_courier_online(boolean) to authenticated;
grant execute on function public.review_store_order(uuid, smallint, smallint, smallint, text) to authenticated;
grant execute on function public.review_store_application(uuid, boolean, text) to authenticated;
grant execute on function public.review_courier_application(uuid, boolean, text) to authenticated;

commit;
