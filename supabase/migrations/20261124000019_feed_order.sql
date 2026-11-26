-- =============================================================================
-- Delta Flow — 0019 Custom feed order
-- content_items.feed_position: order in the Instagram-like preview (0 = top-left).
-- Posts without a position follow the publication date, newest first.
-- The month's approval link shows items in the same order (portal_get orders by
-- approval_batch_items.position), so reordering also reflows that link.
-- Idempotent.
-- =============================================================================
alter table public.content_items add column if not exists feed_position integer;

create or replace function private.reflow_month_feed(p_ws uuid, p_client uuid, p_month date)
returns void language sql security definer set search_path = '' as $$
  update public.approval_batch_items i set position = r.rn
    from (
      select bi.batch_id, bi.content_id,
             (row_number() over (partition by bi.batch_id
                order by c.feed_position nulls last, c.planned_publish_at desc nulls first, c.created_at desc) - 1)::smallint as rn
        from public.approval_batch_items bi
        join public.approval_batches b on b.id = bi.batch_id
        join public.content_items c on c.id = bi.content_id
       where b.workspace_id = p_ws and b.client_id = p_client and b.period_month = date_trunc('month', p_month)::date
    ) r
   where i.batch_id = r.batch_id and i.content_id = r.content_id and i.position is distinct from r.rn;
$$;

-- Saves the order chosen in the feed preview (p_ids from top-left) and reflows the month's link.
create or replace function public.reorder_feed(p_ws uuid, p_client uuid, p_month date, p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_perm(p_ws, 'contents.manage') or private.has_perm(p_ws, 'approvals.manage')) then
    perform private.fail('permission_denied', 'reorder_feed');
  end if;
  if not private.can_access_client(p_ws, p_client) then perform private.fail('permission_denied', 'client'); end if;
  if exists (select 1 from unnest(p_ids) x(id) where not exists (
       select 1 from public.content_items c where c.id = x.id and c.client_id = p_client and c.workspace_id = p_ws)) then
    perform private.fail('validation', 'contents_must_belong_to_client');
  end if;
  update public.content_items c set feed_position = x.ord - 1
    from unnest(p_ids) with ordinality as x(id, ord) where c.id = x.id;
  perform private.reflow_month_feed(p_ws, p_client, p_month);
end $$;

-- "Por data": forget the custom order of the month.
create or replace function public.reset_feed_order(p_ws uuid, p_client uuid, p_month date)
returns void language plpgsql security definer set search_path = '' as $$
declare m0 timestamptz := date_trunc('month', p_month); m1 timestamptz := date_trunc('month', p_month) + interval '1 month';
begin
  if not (private.has_perm(p_ws, 'contents.manage') or private.has_perm(p_ws, 'approvals.manage')) then
    perform private.fail('permission_denied', 'reorder_feed');
  end if;
  if not private.can_access_client(p_ws, p_client) then perform private.fail('permission_denied', 'client'); end if;
  update public.content_items set feed_position = null
   where workspace_id = p_ws and client_id = p_client and feed_position is not null
     and coalesce(planned_publish_at, created_at) >= m0 and coalesce(planned_publish_at, created_at) < m1;
  perform private.reflow_month_feed(p_ws, p_client, p_month);
end $$;

-- Lets the send action reflow after adding posts to the month's link.
create or replace function public.reflow_feed(p_ws uuid, p_client uuid, p_month date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_perm(p_ws, 'contents.manage') or private.has_perm(p_ws, 'approvals.manage')) then
    perform private.fail('permission_denied', 'reflow_feed');
  end if;
  if not private.can_access_client(p_ws, p_client) then perform private.fail('permission_denied', 'client'); end if;
  perform private.reflow_month_feed(p_ws, p_client, p_month);
end $$;

revoke all on function public.reorder_feed(uuid, uuid, date, uuid[]), public.reset_feed_order(uuid, uuid, date), public.reflow_feed(uuid, uuid, date) from public, anon;
grant execute on function public.reorder_feed(uuid, uuid, date, uuid[]), public.reset_feed_order(uuid, uuid, date), public.reflow_feed(uuid, uuid, date) to authenticated;
