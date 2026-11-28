alter table public.approval_batches add column video_link boolean not null default false;
-- Older video links used this generated name and had no separate type.
update public.approval_batches set video_link = true
where period_month is null and name ~ '^Vídeos — .+ · [0-9]{2}/[0-9]{4}$';

create view private.reviewed_videos as
select c.id, c.workspace_id, c.client_id, c.approval_status,
       coalesce(c.planned_publish_at, c.created_at) as period_at
from public.content_items c join public.content_formats f on f.id = c.format_id
where c.archived_at is null and c.production_status = 'done'
  and c.stage in ('client_approval','ready','scheduled','published')
  and f.key in ('reels','stories','institutional','ad','paid_creative','youtube')
  and exists (
    select 1 from public.deliverables d join public.deliverable_versions v on v.id = d.current_version_id
    where d.content_id = c.id and d.kind = 'video' and d.client_facing and v.released_at is not null
  ) and not exists (
    select 1 from public.deliverables d left join public.deliverable_versions v on v.id = d.current_version_id
    where d.content_id = c.id and d.required and d.client_facing and v.released_at is null
  );

create function public.create_video_link(p_ws uuid, p_client uuid, p_month date, p_ids uuid[], p_expires timestamptz, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ids uuid[]; result jsonb; client_name text;
begin
  perform private.require_perm(p_ws, 'approvals.manage');
  if not private.can_access_client(p_ws, p_client) then perform private.fail('permission_denied', 'client'); end if;
  select name into strict client_name from public.clients where id = p_client and workspace_id = p_ws;
  perform 1 from public.content_items where workspace_id = p_ws and client_id = p_client and id = any(p_ids) order by id for update;
  select array_agg(v.id order by array_position(p_ids,v.id)) into ids from private.reviewed_videos v
    join public.content_items c on c.id = v.id
    where v.workspace_id = p_ws and v.client_id = p_client and v.id = any(p_ids)
      and c.stage = 'client_approval' and v.approval_status in ('not_sent','awaiting','partially_approved')
      and date_trunc('month', v.period_at at time zone 'UTC')::date = p_month;
  if ids is null then raise exception 'no_reviewed_videos'; end if;
  result := public.create_approval_batch(p_ws,p_client,'Vídeos — ' || client_name || ' · ' || to_char(p_month,'MM/YYYY'),ids,null,p_expires,p_pin);
  update public.approval_batches set video_link = true where id = (result->>'batch_id')::uuid;
  return result || jsonb_build_object('sent', cardinality(ids));
end $$;
revoke all on function public.create_video_link(uuid,uuid,date,uuid[],timestamptz,text) from public, anon;
grant execute on function public.create_video_link(uuid,uuid,date,uuid[],timestamptz,text) to authenticated;

-- Resolve membership against current released versions when displaying or bulk-approving a link.
create view private.portal_batch_items as
select i.* from public.approval_batch_items i join public.approval_batches b on b.id = i.batch_id
where not b.video_link or exists (select 1 from private.reviewed_videos v where v.id = i.content_id);

do $$
declare fn regprocedure; definition text;
begin
  foreach fn in array array[
    'public.portal_get(text,text)'::regprocedure,
    'public.portal_bulk_approve(text,text,uuid,text,text,boolean)'::regprocedure
  ] loop
    definition := pg_get_functiondef(fn);
    execute replace(definition,'from public.approval_batch_items','from private.portal_batch_items');
  end loop;
end $$;
