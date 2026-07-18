-- Development-only seed. It creates no passwords and must never run in production.
begin;

insert into public.user_roles(profile_id, role)
select id, 'merchant'::public.app_role from auth.users where email = 'lojista.teste@vemperto.example'
on conflict do nothing;
insert into public.user_roles(profile_id, role)
select id, 'courier'::public.app_role from auth.users where email = 'motoboy.teste@vemperto.example'
on conflict do nothing;
insert into public.user_roles(profile_id, role)
select id, 'admin'::public.app_role from auth.users where email = 'admin.teste@vemperto.example'
on conflict do nothing;

insert into public.categories(name, slug) values ('Lanches', 'lanches')
on conflict (slug) do update set name = excluded.name, is_active = true;

insert into public.stores(owner_id, name, slug, category_label, status, is_accepting_orders, min_order_amount, open_time, close_time)
select id, 'Burguer de Teste', 'burguer-teste', 'Lanches', 'approved', true, 15.00, '10:00', '23:00'
from auth.users where email = 'lojista.teste@vemperto.example'
on conflict (slug) do update set
  owner_id = excluded.owner_id, status = 'approved', is_accepting_orders = true,
  min_order_amount = excluded.min_order_amount, open_time = excluded.open_time, close_time = excluded.close_time;

insert into public.store_delivery_zones(store_id, name, max_distance_km, base_delivery_fee, fee_per_km, is_active)
select id, 'Centro - Teste', 8, 4.50, 0, true from public.stores where slug = 'burguer-teste'
on conflict (store_id, name) do update set max_distance_km = excluded.max_distance_km, base_delivery_fee = excluded.base_delivery_fee, is_active = true;

insert into public.products(store_id, category_id, name, description, sku, price, is_available, stock_quantity, prep_minutes)
select s.id, c.id, 'Combo Teste', 'Hambúrguer, batata e bebida para validar o fluxo.', 'COMBO-TESTE', 29.90, true, 50, 20
from public.stores s cross join public.categories c where s.slug = 'burguer-teste' and c.slug = 'lanches'
on conflict (store_id, sku) do update set
  price = excluded.price, is_available = true, stock_quantity = 50, prep_minutes = excluded.prep_minutes,
  name = excluded.name, description = excluded.description;

insert into public.couriers(profile_id, status, is_online)
select id, 'approved', true from auth.users where email = 'motoboy.teste@vemperto.example'
on conflict (profile_id) do update set status = 'approved', is_online = true;

insert into public.addresses(profile_id, label, recipient_name, phone, postal_code, street, number, neighborhood, city, state, is_default)
select id, 'Casa de teste', 'Cliente de teste', '(11) 99999-0000', '01001-000', 'Rua de Teste', '100', 'Centro', 'Cidade de Teste', 'SP', true
from auth.users where email = 'cliente.teste@vemperto.example'
and not exists (select 1 from public.addresses a where a.profile_id = auth.users.id and a.label = 'Casa de teste');

insert into public.coupons(code, discount_type, amount, min_order_amount, max_total_uses, max_uses_per_customer, is_active)
values ('DEV10', 'percent', 10, 20, 100, 1, true)
on conflict (code) do update set discount_type = excluded.discount_type, amount = excluded.amount,
  min_order_amount = excluded.min_order_amount, max_total_uses = excluded.max_total_uses,
  max_uses_per_customer = excluded.max_uses_per_customer, is_active = true;

commit;
