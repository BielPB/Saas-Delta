-- =============================================================================
-- Delta Flow — 0015 "Mês ativo no link"
-- One approval link per client and month. Sending the feed again adds the new
-- posts to the link the client already has (the token is never shown twice, so
-- the agency keeps sending the same URL). Creates the link when there is none,
-- generating a PIN when the client or workspace requires one.
-- Idempotent.
-- =============================================================================
alter table public.approval_batches add column if not exists period_month date;
create index if not exists approval_batches_period_idx on public.approval_batches (client_id, period_month);

create or replace function public.send_month_feed(p_ws uuid, p_client uuid, p_month date, p_content_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_batch uuid; v_added integer := 0; v_pos integer;
  cl public.clients%rowtype; s public.workspace_settings%rowtype;
  v_pin text; r jsonb;
begin
  perform private.require_perm(p_ws, 'approvals.manage');
  if not private.can_access_client(p_ws, p_client) then perform private.fail('permission_denied', 'client'); end if;
  if coalesce(array_length(p_content_ids, 1), 0) = 0 then perform private.fail('validation', 'contents'); end if;

  -- Existing month link that the client can still open.
  select b.id into v_batch from public.approval_batches b
   where b.workspace_id = p_ws and b.client_id = p_client and b.period_month = v_month and b.status in ('open', 'submitted')
     and exists (select 1 from public.approval_links l where l.batch_id = b.id and l.revoked_at is null and (l.expires_at is null or l.expires_at > now()))
   order by b.created_at desc limit 1;

  if v_batch is not null then
    if exists (
      select 1 from unnest(p_content_ids) x(id)
       where not exists (select 1 from public.content_items c where c.id = x.id and c.client_id = p_client and c.workspace_id = p_ws and c.archived_at is null)
    ) then perform private.fail('validation', 'contents_must_belong_to_client'); end if;
    if exists (
      select 1 from public.deliverables d left join public.deliverable_versions v on v.id = d.current_version_id
       where d.content_id = any(p_content_ids) and d.required and d.client_facing and (v.id is null or v.released_at is null)
    ) then perform private.fail('invalid_transition', 'not_reviewed'); end if;

    select coalesce(max(position), -1) + 1 into v_pos from public.approval_batch_items where batch_id = v_batch;
    perform private.allow_state_change();
    with ins as (
      insert into public.approval_batch_items (workspace_id, batch_id, content_id, position)
      select p_ws, v_batch, x.id, (v_pos + x.ord - 1)::smallint from unnest(p_content_ids) with ordinality as x(id, ord)
      on conflict (batch_id, content_id) do nothing
      returning 1)
    select count(*) into v_added from ins;
    update public.approval_batches set status = 'open', submitted_at = null where id = v_batch and status <> 'open';
    perform private.recompute_content(x) from unnest(p_content_ids) as x;
    perform private.log_activity(p_ws, 'approval_batch', v_batch, 'approval.batch_extended', p_client, null, jsonb_build_object('added', v_added));
    return jsonb_build_object('batch_id', v_batch, 'existing', true, 'added', v_added);
  end if;

  select * into cl from public.clients where id = p_client and workspace_id = p_ws;
  select * into s from public.workspace_settings where workspace_id = p_ws;
  if cl.is_sensitive or coalesce(s.approval_require_pin, false) then
    v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');
  end if;
  r := public.create_approval_batch(p_ws, p_client,
         'Preview — ' || cl.name || ' · ' || to_char(v_month, 'MM/YYYY'), p_content_ids, null,
         case when cl.is_sensitive then now() + interval '30 days' else greatest(now() + interval '15 days', (v_month + interval '2 months')::timestamptz) end,
         v_pin);
  update public.approval_batches set period_month = v_month where id = (r ->> 'batch_id')::uuid;
  return r || jsonb_build_object('existing', false, 'added', array_length(p_content_ids, 1), 'pin', v_pin);
end $$;
revoke all on function public.send_month_feed(uuid, uuid, date, uuid[]) from public, anon;
grant execute on function public.send_month_feed(uuid, uuid, date, uuid[]) to authenticated;
