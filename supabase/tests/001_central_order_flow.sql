-- Development integration test. It always rolls back its own test order.
begin;

do $$
declare
  v_customer_id uuid;
  v_merchant_id uuid;
  v_courier_profile_id uuid;
  v_store_id uuid;
  v_address_id uuid;
  v_zone_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_duplicate_order_id uuid;
  v_second_request_id uuid := gen_random_uuid();
  v_coupon_rejected boolean := false;
begin
  select id into v_customer_id from auth.users where email = 'cliente.teste@vemperto.example';
  select id into v_merchant_id from auth.users where email = 'lojista.teste@vemperto.example';
  select id into v_courier_profile_id from auth.users where email = 'motoboy.teste@vemperto.example';
  select id into v_store_id from public.stores where slug = 'burguer-teste';
  select id into v_address_id from public.addresses where profile_id = v_customer_id and label = 'Casa de teste';
  select id into v_zone_id from public.store_delivery_zones where store_id = v_store_id and name = 'Centro - Teste';
  select id into v_product_id from public.products where store_id = v_store_id and sku = 'COMBO-TESTE';

  if v_customer_id is null or v_merchant_id is null or v_courier_profile_id is null or v_store_id is null or v_address_id is null or v_zone_id is null or v_product_id is null then
    raise exception 'Development seed is incomplete';
  end if;

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_customer_id::text, true);
  v_order_id := public.create_order(v_store_id, v_address_id, v_zone_id,
    jsonb_build_array(jsonb_build_object('product_id', v_product_id, 'quantity', 1)), gen_random_uuid(), 'DEV10');

  v_duplicate_order_id := public.create_order(v_store_id, v_address_id, v_zone_id,
    jsonb_build_array(jsonb_build_object('product_id', v_product_id, 'quantity', 1)),
    (select client_request_id from public.orders where id = v_order_id), 'DEV10');
  if v_duplicate_order_id <> v_order_id then raise exception 'Idempotency failed'; end if;

  begin
    perform public.create_order(v_store_id, v_address_id, v_zone_id,
      jsonb_build_array(jsonb_build_object('product_id', v_product_id, 'quantity', 1)), v_second_request_id, 'DEV10');
  exception when others then
    v_coupon_rejected := true;
  end;
  if not v_coupon_rejected then raise exception 'Coupon duplicate protection failed'; end if;

  perform set_config('request.jwt.claim.sub', v_merchant_id::text, true);
  perform public.transition_order(v_order_id, 'accepted_by_store', jsonb_build_object('prep_minutes', 18));
  perform public.transition_order(v_order_id, 'preparing');
  perform public.transition_order(v_order_id, 'ready_for_pickup');
  perform public.transition_order(v_order_id, 'awaiting_courier');

  perform set_config('request.jwt.claim.sub', v_courier_profile_id::text, true);
  perform public.assign_courier(v_order_id);
  perform public.transition_order(v_order_id, 'courier_to_store');
  perform public.transition_order(v_order_id, 'picked_up');
  perform public.transition_order(v_order_id, 'on_the_way');
  perform public.transition_order(v_order_id, 'delivered');

  perform set_config('request.jwt.claim.sub', v_customer_id::text, true);
  perform public.review_store_order(v_order_id, 5::smallint, 5::smallint, 5::smallint, 'Fluxo central validado.');

  if (select status from public.orders where id = v_order_id) <> 'delivered' then raise exception 'Delivery state failed'; end if;
  if not exists (select 1 from public.order_financials where order_id = v_order_id and total_paid > 0 and shop_net >= 0 and courier_net >= 0) then raise exception 'Financial record failed'; end if;
  if not exists (select 1 from public.reviews where order_id = v_order_id) then raise exception 'Review write failed'; end if;
end;
$$;

rollback;
