-- Development-only Stage 2 verification. The transaction always rolls back.
begin;

do $$
declare
  v_customer uuid := '711678d2-3934-49c4-8c82-9c0f492d3df8';
  v_admin uuid := 'ab0d6f0d-5583-4c4f-9ea8-a537207a4767';
  v_store_id uuid;
  v_existing_store_id uuid;
  v_favorite_count integer;
  v_coupon_id uuid;
begin
  perform set_config('request.jwt.claim.sub', v_customer::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select public.submit_store_application(
    'Loja Etapa Dois', 'Lanches', '(00) 99999-0000', '10:00'::time, '22:00'::time, 10,
    jsonb_build_array(jsonb_build_object('name', 'Centro - Etapa 2', 'max_distance_km', 5, 'base_delivery_fee', 4, 'fee_per_km', 0))
  ) into v_store_id;

  if not exists (select 1 from public.stores where id = v_store_id and owner_id = v_customer and status = 'pending') then
    raise exception 'Store application was not created';
  end if;
  if not exists (select 1 from public.user_roles where profile_id = v_customer and role = 'merchant') then
    raise exception 'Merchant role was not granted';
  end if;

  select id into v_existing_store_id from public.stores where slug = 'burguer-teste';
  insert into public.store_favorites(profile_id, store_id) values (v_customer, v_existing_store_id);
  select count(*) into v_favorite_count from public.store_favorites where profile_id = v_customer and store_id = v_existing_store_id;
  if v_favorite_count <> 1 then raise exception 'Favorite was not persisted'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform public.review_store_application(v_store_id, true, 'stage 2 test');
  if not exists (select 1 from public.stores where id = v_store_id and status = 'approved') then
    raise exception 'Administrator could not approve store';
  end if;
  select public.admin_upsert_coupon('ETAPA2', 'percent'::public.discount_type, 12, 20) into v_coupon_id;
  if not exists (select 1 from public.coupons where id = v_coupon_id and code = 'ETAPA2') then
    raise exception 'Administrator coupon was not created';
  end if;
  perform public.admin_replace_categories(jsonb_build_array('Lanches', 'Etapa Dois'));
  if not exists (select 1 from public.categories where name = 'Etapa Dois' and is_active) then
    raise exception 'Administrator categories were not updated';
  end if;
end;
$$;

rollback;
