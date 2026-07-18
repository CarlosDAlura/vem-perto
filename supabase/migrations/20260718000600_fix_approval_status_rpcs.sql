-- Vem Perto: fix enum assignments in approval RPCs discovered by Stage 2 tests.
begin;

create or replace function public.review_store_application(p_store_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.has_role('admin') then raise exception 'Administrator role is required'; end if;
  update public.stores set
    status = case when p_approve then 'approved'::public.approval_status else 'rejected'::public.approval_status end,
    is_accepting_orders = case when p_approve then is_accepting_orders else false end
  where id = p_store_id and status = 'pending'::public.approval_status;
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
  update public.couriers set
    status = case when p_approve then 'approved'::public.approval_status else 'rejected'::public.approval_status end,
    is_online = false
  where id = p_courier_id and status = 'pending'::public.approval_status;
  if not found then raise exception 'Pending courier was not found'; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'courier.reviewed', 'courier', p_courier_id, jsonb_build_object('approved', p_approve, 'reason', p_reason));
end;
$$;

revoke execute on function public.review_store_application(uuid, boolean, text) from public, anon;
revoke execute on function public.review_courier_application(uuid, boolean, text) from public, anon;
grant execute on function public.review_store_application(uuid, boolean, text) to authenticated;
grant execute on function public.review_courier_application(uuid, boolean, text) to authenticated;

commit;
