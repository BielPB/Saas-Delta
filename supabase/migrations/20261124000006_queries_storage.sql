-- =============================================================================
-- Delta Flow — 0006 Read models (SECURITY INVOKER: RLS always applies),
-- storage bucket & policies, final grants.
--
-- Counting rule: indicators count CONTENTS. A Reels with video + cover +
-- caption is ONE content. Deliverable readiness is reported as "contents
-- whose <kind> is ready", never as a sum of deliverables.
--
-- Reference date of a content for period filters:
--   coalesce(planned_publish_at, due_at, created_at)
-- =============================================================================

create or replace function public.content_ref_date(c public.content_items)
returns timestamptz language sql immutable as $$
  select coalesce(c.planned_publish_at, c.due_at, c.created_at)
$$;

-- -----------------------------------------------------------------------------
-- Dashboard
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_summary(
  p_ws uuid, p_from timestamptz, p_to timestamptz,
  p_client uuid default null, p_service uuid default null, p_format uuid default null, p_member uuid default null)
returns jsonb language plpgsql stable as $$
declare v jsonb;
begin
  with c as (
    select ci.* from public.content_items ci
     where ci.workspace_id = p_ws and ci.archived_at is null
       and coalesce(ci.planned_publish_at, ci.due_at, ci.created_at) >= p_from
       and coalesce(ci.planned_publish_at, ci.due_at, ci.created_at) <  p_to
       and (p_client is null or ci.client_id = p_client)
       and (p_service is null or ci.service_id = p_service)
       and (p_format is null or ci.format_id = p_format)
       and (p_member is null
            or exists (select 1 from public.tasks t where t.content_id = ci.id and t.assignee_id = p_member)
            or exists (select 1 from public.content_assignees a where a.content_id = ci.id and a.user_id = p_member))
  ), t as (
    select tk.* from public.tasks tk
      left join public.content_items x on x.id = tk.content_id
     where tk.workspace_id = p_ws
       and (p_client is null or tk.client_id = p_client)
       and (p_member is null or tk.assignee_id = p_member)
       and (p_service is null or x.service_id = p_service)
       and (p_format is null or x.format_id = p_format)
  ), approved_at as (
    select c.id, max(r.created_at) as at, min(b.created_at) as sent_at,
           bool_or(r.decision = 'rejected') as had_rejection
      from c
      join public.approval_responses r on r.content_id = c.id
      join public.approval_batch_items i on i.content_id = c.id
      join public.approval_batches b on b.id = i.batch_id
     where c.approval_status = 'approved'
     group by c.id
  )
  select jsonb_build_object(
    'active_clients',     (select count(*) from public.clients cl where cl.workspace_id = p_ws and cl.status = 'active'
                             and (p_client is null or cl.id = p_client)),
    'planned',            (select count(*) from c where publication_status <> 'cancelled'),
    'in_production',      (select count(*) from c where production_status = 'in_production'),
    'awaiting_edit',      (select count(*) from c where stage = 'editing'),
    'internal_review',    (select count(*) from c where production_status = 'internal_review'),
    'awaiting_approval',  (select count(*) from c where approval_status in ('awaiting', 'partially_approved')),
    'approved',           (select count(*) from c where approval_status = 'approved'),
    'scheduled',          (select count(*) from c where publication_status = 'scheduled'),
    'published',          (select count(*) from c where publication_status = 'published'),
    'rejected',           (select count(*) from c where approval_status = 'rejected' or production_status = 'adjustments'),
    'tasks_overdue',      (select count(*) from t where status not in ('done', 'cancelled', 'blocked') and due_at < now()),
    'tasks_done',         (select count(*) from t where status = 'done' and completed_at >= p_from and completed_at < p_to),
    'by_stage',           coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) n from c group by stage) s), '{}'),
    'by_member',          coalesce((
                            select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', coalesce(nullif(p.full_name, ''), p.email),
                                     'open', m.open, 'overdue', m.overdue) order by m.open desc)
                              from (select assignee_id as user_id,
                                           count(*) filter (where status not in ('done', 'cancelled')) as open,
                                           count(*) filter (where status not in ('done', 'cancelled', 'blocked') and due_at < now()) as overdue
                                      from t where assignee_id is not null group by assignee_id) m
                              join public.profiles p on p.id = m.user_id), '[]'),
    'first_pass_rate',    (select round(100.0 * count(*) filter (where not had_rejection) / nullif(count(*), 0), 1) from approved_at),
    'avg_approval_hours', (select round(extract(epoch from avg(at - sent_at)) / 3600.0, 1) from approved_at),
    'top_pending_clients', coalesce((
                            select jsonb_agg(x order by (x ->> 'pending')::int desc)
                              from (select jsonb_build_object('client_id', cl.id, 'name', cl.name, 'pending', count(*)) x
                                      from c join public.clients cl on cl.id = c.client_id
                                     where c.publication_status not in ('published', 'cancelled')
                                     group by cl.id, cl.name order by count(*) desc limit 5) z), '[]'),
    'monthly',            coalesce((
                            select jsonb_agg(jsonb_build_object('month', to_char(mon, 'YYYY-MM'), 'planned', planned,
                                                                'approved', approved, 'published', published) order by mon)
                              from (select date_trunc('month', coalesce(ci.planned_publish_at, ci.due_at, ci.created_at)) mon,
                                           count(*) filter (where ci.publication_status <> 'cancelled') planned,
                                           count(*) filter (where ci.approval_status = 'approved') approved,
                                           count(*) filter (where ci.publication_status = 'published') published
                                      from public.content_items ci
                                     where ci.workspace_id = p_ws and ci.archived_at is null
                                       and (p_client is null or ci.client_id = p_client)
                                       and (p_service is null or ci.service_id = p_service)
                                       and (p_format is null or ci.format_id = p_format)
                                       and coalesce(ci.planned_publish_at, ci.due_at, ci.created_at) >= date_trunc('month', now()) - interval '5 months'
                                       and coalesce(ci.planned_publish_at, ci.due_at, ci.created_at) <  date_trunc('month', now()) + interval '1 month'
                                     group by 1) mm), '[]'),
    'upcoming',           coalesce((
                            select jsonb_agg(jsonb_build_object('id', u.id, 'code', u.code, 'title', u.title, 'client', cl.name,
                                     'at', coalesce(u.scheduled_at, u.planned_publish_at), 'publication_status', u.publication_status,
                                     'approval_status', u.approval_status, 'channel', u.channel) order by coalesce(u.scheduled_at, u.planned_publish_at))
                              from (select * from public.content_items ci
                                     where ci.workspace_id = p_ws and ci.archived_at is null
                                       and ci.publication_status in ('planned', 'ready', 'scheduled')
                                       and coalesce(ci.scheduled_at, ci.planned_publish_at) >= now()
                                       and (p_client is null or ci.client_id = p_client)
                                     order by coalesce(ci.scheduled_at, ci.planned_publish_at) limit 8) u
                              join public.clients cl on cl.id = u.client_id), '[]')
  ) into v;
  return v;
end $$;

-- Items that need a manager's intervention. Each list is capped and links to
-- a filtered view in the app.
create or replace function public.dashboard_attention(p_ws uuid)
returns jsonb language plpgsql stable as $$
declare v jsonb; v_stale integer;
begin
  select coalesce(approval_stale_after_days, 3) into v_stale from public.workspace_settings where workspace_id = p_ws;
  select jsonb_build_object(
    'overdue_tasks', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', t.id, 'title', t.title, 'due_at', t.due_at, 'assignee_id', t.assignee_id) x
          from public.tasks t where t.workspace_id = p_ws and t.status not in ('done', 'cancelled', 'blocked') and t.due_at < now()
         order by t.due_at limit 10) s), '[]'),
    'rejected_contents', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', c.id, 'code', c.code, 'title', c.title) x from public.content_items c
         where c.workspace_id = p_ws and c.archived_at is null and (c.approval_status = 'rejected' or c.production_status = 'adjustments')
         order by c.updated_at desc limit 10) s), '[]'),
    'stale_approvals', coalesce((select jsonb_agg(x) from (
        select distinct on (c.id) jsonb_build_object('id', c.id, 'code', c.code, 'title', c.title, 'sent_at', b.created_at) x
          from public.content_items c join public.approval_batch_items i on i.content_id = c.id
          join public.approval_batches b on b.id = i.batch_id
         where c.workspace_id = p_ws and c.approval_status in ('awaiting', 'partially_approved')
           and b.created_at < now() - make_interval(days => v_stale)
         order by c.id, b.created_at limit 10) s), '[]'),
    'unapproved_soon', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', c.id, 'code', c.code, 'title', c.title, 'at', c.planned_publish_at) x
          from public.content_items c
         where c.workspace_id = p_ws and c.archived_at is null and c.approval_status <> 'approved'
           and c.publication_status in ('planned', 'unscheduled')
           and c.planned_publish_at between now() and now() + interval '72 hours'
         order by c.planned_publish_at limit 10) s), '[]'),
    'missing_files', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', a.id, 'name', a.name, 'client_id', a.client_id) x
          from public.file_assets a where a.workspace_id = p_ws and a.status = 'missing' and a.archived_at is null
         order by a.updated_at desc limit 10) s), '[]'),
    'unconfirmed_published', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', c.id, 'code', c.code, 'title', c.title, 'at', c.scheduled_at) x
          from public.content_items c
         where c.workspace_id = p_ws and c.publication_status = 'scheduled' and c.scheduled_at < now()
         order by c.scheduled_at limit 10) s), '[]'),
    'late_publications', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', c.id, 'code', c.code, 'title', c.title, 'at', c.planned_publish_at) x
          from public.content_items c
         where c.workspace_id = p_ws and c.archived_at is null and c.publication_status in ('planned', 'ready', 'unscheduled')
           and c.planned_publish_at < now()
         order by c.planned_publish_at limit 10) s), '[]'),
    'clients_below_target', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('client_id', p.client_id, 'name', p.client_name, 'target', p.target, 'produced', p.produced,
                                  'expected', p.expected) x
          from (
            select cl.id client_id, cl.name client_name,
                   coalesce(mt.target, cl.monthly_target) target,
                   (select count(*) from public.content_items ci where ci.client_id = cl.id and ci.archived_at is null
                       and ci.publication_status <> 'cancelled'
                       and (ci.approval_status = 'approved' or ci.publication_status in ('scheduled', 'published'))
                       and coalesce(ci.planned_publish_at, ci.due_at, ci.created_at) >= date_trunc('month', now())
                       and coalesce(ci.planned_publish_at, ci.due_at, ci.created_at) <  date_trunc('month', now()) + interval '1 month') produced,
                   floor(coalesce(mt.target, cl.monthly_target)
                         * extract(day from now()) / extract(day from date_trunc('month', now()) + interval '1 month - 1 day')) expected
              from public.clients cl
              left join public.monthly_targets mt on mt.client_id = cl.id and mt.service_id is null and mt.format_id is null
                                                  and mt.month = date_trunc('month', now())::date
             where cl.workspace_id = p_ws and cl.status = 'active') p
         where p.target > 0 and p.produced < p.expected
         order by (p.expected - p.produced) desc limit 10) s), '[]')
  ) into v;
  return v;
end $$;

-- -----------------------------------------------------------------------------
-- Client progress (per service) for a month
-- -----------------------------------------------------------------------------
create or replace function public.client_progress(p_ws uuid, p_month date, p_client uuid default null)
returns table (
  client_id uuid, client_name text, client_target integer,
  service_id uuid, service_name text, service_color text, service_target integer,
  planned bigint, videos_ready bigint, covers_ready bigint, captions_ready bigint,
  approved bigint, scheduled bigint, published bigint)
language sql stable as $$
  with month_bounds as (
    select date_trunc('month', p_month)::timestamptz as m0, (date_trunc('month', p_month) + interval '1 month')::timestamptz as m1
  ), c as (
    select ci.*,
      exists (select 1 from public.deliverables d where d.content_id = ci.id and d.kind = 'video'   and d.current_version_id is not null) as v_ok,
      exists (select 1 from public.deliverables d where d.content_id = ci.id and d.kind in ('cover', 'image', 'carousel') and d.current_version_id is not null) as cv_ok,
      exists (select 1 from public.deliverables d where d.content_id = ci.id and d.kind = 'caption' and d.current_version_id is not null) as cp_ok
    from public.content_items ci, month_bounds mb
    where ci.workspace_id = p_ws and ci.archived_at is null and ci.publication_status <> 'cancelled'
      and coalesce(ci.planned_publish_at, ci.due_at, ci.created_at) >= mb.m0
      and coalesce(ci.planned_publish_at, ci.due_at, ci.created_at) <  mb.m1
      and (p_client is null or ci.client_id = p_client)
  ), svc as (
    select cl.id cid, cl.name cname, cl.monthly_target ctarget, s.id sid, s.name sname, s.color scolor, s.monthly_target starget
      from public.clients cl
      left join public.client_services s on s.client_id = cl.id and s.active
     where cl.workspace_id = p_ws and cl.status = 'active' and (p_client is null or cl.id = p_client)
    union all
    select cl.id, cl.name, cl.monthly_target, null, 'Sem serviço', '#737373', null
      from public.clients cl
     where cl.workspace_id = p_ws and cl.status = 'active' and (p_client is null or cl.id = p_client)
       and exists (select 1 from c where c.client_id = cl.id and c.service_id is null)
  )
  select svc.cid, svc.cname,
         coalesce((select mt.target from public.monthly_targets mt where mt.client_id = svc.cid and mt.service_id is null
                    and mt.format_id is null and mt.month = date_trunc('month', p_month)::date), svc.ctarget)::integer,
         svc.sid, svc.sname, svc.scolor,
         coalesce((select mt.target from public.monthly_targets mt where mt.client_id = svc.cid and mt.service_id = svc.sid
                    and mt.format_id is null and mt.month = date_trunc('month', p_month)::date), svc.starget)::integer,
         count(c.id),
         count(c.id) filter (where c.v_ok),
         count(c.id) filter (where c.cv_ok),
         count(c.id) filter (where c.cp_ok),
         count(c.id) filter (where c.approval_status = 'approved'),
         count(c.id) filter (where c.publication_status = 'scheduled'),
         count(c.id) filter (where c.publication_status = 'published')
    from svc
    left join c on c.client_id = svc.cid and c.service_id is not distinct from svc.sid
   group by svc.cid, svc.cname, svc.ctarget, svc.sid, svc.sname, svc.scolor, svc.starget
   order by svc.cname, svc.sid is null, svc.sname
$$;

-- -----------------------------------------------------------------------------
-- Workload & reports
-- -----------------------------------------------------------------------------
create or replace function public.team_workload(p_ws uuid)
returns table (user_id uuid, full_name text, email text, open_tasks bigint, in_progress bigint,
               overdue bigint, due_this_week bigint, done_30d bigint, overloaded boolean)
language sql stable as $$
  with m as (
    select wm.user_id, p.full_name, p.email,
           count(t.id) filter (where t.status not in ('done', 'cancelled')) open_tasks,
           count(t.id) filter (where t.status = 'in_progress') in_progress,
           count(t.id) filter (where t.status not in ('done', 'cancelled', 'blocked') and t.due_at < now()) overdue,
           count(t.id) filter (where t.status not in ('done', 'cancelled') and t.due_at between now() and now() + interval '7 days') due_week,
           count(t.id) filter (where t.status = 'done' and t.completed_at > now() - interval '30 days') done_30d
      from public.workspace_members wm
      join public.profiles p on p.id = wm.user_id
      left join public.tasks t on t.assignee_id = wm.user_id and t.workspace_id = wm.workspace_id
     where wm.workspace_id = p_ws and wm.status = 'active'
     group by wm.user_id, p.full_name, p.email
  ), avg_open as (select avg(open_tasks) a from m where open_tasks > 0)
  select m.user_id, m.full_name, m.email, m.open_tasks, m.in_progress, m.overdue, m.due_week, m.done_30d,
         (m.overdue >= 3 or (m.open_tasks >= 5 and m.open_tasks > 1.5 * coalesce((select a from avg_open), 0)))
    from m order by m.open_tasks desc
$$;

create or replace function public.report_clients(p_ws uuid, p_from timestamptz, p_to timestamptz)
returns table (client_id uuid, client_name text, contracted bigint, produced bigint, approved bigint, published bigint,
               target_pct numeric, adjustments bigint, avg_approval_hours numeric, by_service jsonb, by_format jsonb)
language sql stable as $$
  with c as (
    select ci.* from public.content_items ci
     where ci.workspace_id = p_ws and ci.archived_at is null and ci.publication_status <> 'cancelled'
       and coalesce(ci.planned_publish_at, ci.due_at, ci.created_at) >= p_from
       and coalesce(ci.planned_publish_at, ci.due_at, ci.created_at) <  p_to
  ), months as (
    select generate_series(date_trunc('month', p_from), date_trunc('month', p_to - interval '1 second'), interval '1 month')::date m
  ), contracted as (
    select cl.id, sum(coalesce(mt.target, cl.monthly_target)) total
      from public.clients cl cross join months
      left join public.monthly_targets mt on mt.client_id = cl.id and mt.service_id is null and mt.format_id is null and mt.month = months.m
     where cl.workspace_id = p_ws group by cl.id
  ), appr as (
    select r.content_id, max(r.created_at) at, min(b.created_at) sent
      from public.approval_responses r join public.approval_batches b on b.id = r.batch_id
      join c on c.id = r.content_id and c.approval_status = 'approved'
     group by r.content_id
  )
  select cl.id, cl.name, coalesce(ct.total, 0)::bigint,
         count(c.id) filter (where c.production_status = 'done'),
         count(c.id) filter (where c.approval_status = 'approved'),
         count(c.id) filter (where c.publication_status = 'published'),
         round(100.0 * count(c.id) filter (where c.approval_status = 'approved' or c.publication_status = 'published')
               / nullif(coalesce(ct.total, 0), 0), 1),
         (select count(*) from public.revision_requests rr join c c2 on c2.id = rr.content_id where c2.client_id = cl.id),
         (select round(extract(epoch from avg(a.at - a.sent)) / 3600.0, 1) from appr a join c c3 on c3.id = a.content_id where c3.client_id = cl.id),
         coalesce((select jsonb_object_agg(coalesce(s.name, 'Sem serviço'), n) from (
                     select c4.service_id, count(*) n from c c4 where c4.client_id = cl.id group by c4.service_id) z
                   left join public.client_services s on s.id = z.service_id), '{}'),
         coalesce((select jsonb_object_agg(f.name, n) from (
                     select c5.format_id, count(*) n from c c5 where c5.client_id = cl.id group by c5.format_id) z
                   join public.content_formats f on f.id = z.format_id), '{}')
    from public.clients cl
    left join contracted ct on ct.id = cl.id
    left join c on c.client_id = cl.id
   where cl.workspace_id = p_ws and cl.status <> 'archived'
   group by cl.id, cl.name, ct.total
   order by cl.name
$$;

create or replace function public.report_members(p_ws uuid, p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, full_name text, assigned bigint, done bigint, overdue bigint, in_progress bigint,
               avg_completion_hours numeric, adjustments bigint, open_load bigint)
language sql stable as $$
  select wm.user_id, coalesce(nullif(p.full_name, ''), p.email),
         count(t.id) filter (where t.created_at >= p_from and t.created_at < p_to),
         count(t.id) filter (where t.status = 'done' and t.completed_at >= p_from and t.completed_at < p_to),
         count(t.id) filter (where t.status not in ('done', 'cancelled', 'blocked') and t.due_at < now()),
         count(t.id) filter (where t.status = 'in_progress'),
         round((extract(epoch from avg(t.completed_at - coalesce(t.started_at, t.created_at))
                filter (where t.status = 'done' and t.completed_at >= p_from and t.completed_at < p_to)) / 3600.0)::numeric, 1),
         count(t.id) filter (where t.kind = 'adjustment' and t.created_at >= p_from and t.created_at < p_to),
         count(t.id) filter (where t.status not in ('done', 'cancelled'))
    from public.workspace_members wm
    join public.profiles p on p.id = wm.user_id
    left join public.tasks t on t.assignee_id = wm.user_id and t.workspace_id = wm.workspace_id
   where wm.workspace_id = p_ws and wm.status = 'active'
   group by wm.user_id, p.full_name, p.email
   order by 2
$$;

create or replace function public.report_agency(p_ws uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable as $$
  with c as (
    select ci.* from public.content_items ci
     where ci.workspace_id = p_ws and ci.archived_at is null and ci.publication_status <> 'cancelled'
       and coalesce(ci.planned_publish_at, ci.due_at, ci.created_at) >= p_from
       and coalesce(ci.planned_publish_at, ci.due_at, ci.created_at) <  p_to
  ), appr as (
    select c.id, c.created_at, c.published_at, max(r.created_at) approved_at, bool_or(r.decision = 'rejected') had_rej
      from c join public.approval_responses r on r.content_id = c.id
     where c.approval_status = 'approved' group by c.id, c.created_at, c.published_at
  ), steps as (
    select coalesce(t.step_key, t.kind::text) step,
           count(*) filter (where t.status not in ('done', 'cancelled')) open,
           count(*) filter (where t.status not in ('done', 'cancelled', 'blocked') and t.due_at < now()) overdue,
           round((extract(epoch from avg(t.completed_at - coalesce(t.started_at, t.created_at)) filter (where t.status = 'done')) / 3600.0)::numeric, 1) avg_hours
      from public.tasks t where t.workspace_id = p_ws and t.created_at >= p_from - interval '60 days'
     group by 1
  )
  select jsonb_build_object(
    'contents',              (select count(*) from c),
    'approved',              (select count(*) from c where approval_status = 'approved'),
    'published',             (select count(*) from c where publication_status = 'published'),
    'first_pass_rate',       (select round(100.0 * count(*) filter (where not had_rej) / nullif(count(*), 0), 1) from appr),
    'avg_planning_to_approval_hours', (select round((extract(epoch from avg(approved_at - created_at)) / 3600.0)::numeric, 1) from appr),
    'avg_approval_to_publication_hours', (select round((extract(epoch from avg(published_at - approved_at)) / 3600.0)::numeric, 1)
                                            from appr where published_at is not null),
    'adjustments',           (select count(*) from public.revision_requests r join c on c.id = r.content_id),
    'bottlenecks',           coalesce((select jsonb_agg(to_jsonb(s) order by s.overdue desc, s.open desc) from steps s), '[]'),
    'by_format',             coalesce((select jsonb_object_agg(f.name, n) from (select format_id, count(*) n from c group by format_id) z
                                        join public.content_formats f on f.id = z.format_id), '{}')
  )
$$;

-- -----------------------------------------------------------------------------
-- Global search (respects RLS: only rows the caller can see are returned)
-- -----------------------------------------------------------------------------
create or replace function public.search_global(p_ws uuid, p_q text)
returns table (kind text, id uuid, title text, subtitle text, href text)
language sql stable as $$
  with q as (select '%' || replace(replace(replace(lower(btrim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
                    case when btrim(p_q) ~ '^#?[0-9]+$' then ltrim(btrim(p_q), '#')::integer end as code)
  (select 'client', c.id, c.name, coalesce(c.segment, c.company_name), '/app/clientes/' || c.id
     from public.clients c, q where c.workspace_id = p_ws and (lower(c.name) like q.pat or lower(coalesce(c.company_name, '')) like q.pat) limit 6)
  union all
  (select 'content', ci.id, '#' || ci.code || ' ' || ci.title, cl.name, '/app/conteudos/' || ci.id
     from public.content_items ci join public.clients cl on cl.id = ci.client_id, q
    where ci.workspace_id = p_ws and ci.archived_at is null and (lower(ci.title) like q.pat or ci.code = q.code) limit 8)
  union all
  (select 'task', t.id, t.title, t.status::text, '/app/tarefas/' || t.id
     from public.tasks t, q where t.workspace_id = p_ws and lower(t.title) like q.pat and t.status <> 'cancelled' limit 6)
  union all
  (select 'service', s.id, s.name, cl.name, '/app/clientes/' || s.client_id || '?aba=servicos'
     from public.client_services s join public.clients cl on cl.id = s.client_id, q
    where s.workspace_id = p_ws and lower(s.name) like q.pat limit 5)
  union all
  (select 'file', a.id, a.name, a.category, '/app/arquivos?arquivo=' || a.id
     from public.file_assets a, q where a.workspace_id = p_ws and a.archived_at is null and lower(a.name) like q.pat limit 6)
  union all
  (select 'member', p.id, coalesce(nullif(p.full_name, ''), p.email), p.email, '/app/colaboradores?u=' || p.id
     from public.workspace_members m join public.profiles p on p.id = m.user_id, q
    where m.workspace_id = p_ws and m.status = 'active' and (lower(p.full_name) like q.pat or lower(coalesce(p.email, '')) like q.pat) limit 5)
  union all
  (select 'approval', b.id, b.name, cl.name, '/app/aprovacoes/' || b.id
     from public.approval_batches b join public.clients cl on cl.id = b.client_id, q
    where b.workspace_id = p_ws and lower(b.name) like q.pat limit 5)
$$;

-- -----------------------------------------------------------------------------
-- Smart import: suggestions for an unlinked asset. Never links automatically.
-- -----------------------------------------------------------------------------
create or replace function public.suggest_asset_links(p_asset uuid)
returns table (content_id uuid, code integer, title text, deliverable_id uuid, deliverable_kind public.deliverable_kind,
               score integer, reasons text[])
language sql stable as $$
  with a as (select * from public.file_assets where id = p_asset),
  words as (select distinct w from a, regexp_split_to_table(lower(regexp_replace(a.name, '\.[a-z0-9]+$', '')), '[^a-z0-9à-ú]+') w
             where char_length(w) >= 4),
  cand as (
    select c.id, c.code, c.title, d.id did, d.kind,
      (case when a.name ~* ('(^|[^0-9])#?' || c.code || '([^0-9]|$)') then 50 else 0 end)
      + (case when a.service_id is not null and a.service_id = c.service_id then 20 else 0 end)
      + (select count(*) * 8 from words where lower(c.title) like '%' || words.w || '%')::integer
      + (case when d.current_version_id is null then 10 else 0 end)
      + (case when exists (select 1 from public.tasks t where t.deliverable_id = d.id and t.status in ('pending', 'in_progress', 'reopened')) then 10 else 0 end)
      as score,
      array_remove(array[
        case when a.name ~* ('(^|[^0-9])#?' || c.code || '([^0-9]|$)') then 'código no nome do arquivo' end,
        case when a.service_id is not null and a.service_id = c.service_id then 'mesmo serviço da pasta' end,
        case when exists (select 1 from words where lower(c.title) like '%' || words.w || '%') then 'palavras do título' end,
        case when d.current_version_id is null then 'entregável ainda sem arquivo' end], null) as reasons
    from a
    join public.content_items c on c.client_id = a.client_id and c.archived_at is null and c.publication_status not in ('published', 'cancelled')
    join public.deliverables d on d.content_id = c.id and d.kind = case
         when a.mime_type like 'video/%' and a.category = 'raw' then 'raw_footage'::public.deliverable_kind
         when a.mime_type like 'video/%' then 'video'::public.deliverable_kind
         when a.mime_type like 'image/%' and a.category = 'cover' then 'cover'::public.deliverable_kind
         when a.mime_type like 'image/%' and a.category = 'carousel' then 'carousel'::public.deliverable_kind
         when a.mime_type like 'image/%' then d.kind
         else d.kind end
     and (a.mime_type not like 'image/%' or d.kind in ('cover', 'image', 'carousel'))
     and (a.mime_type not like 'video/%' or d.kind in ('video', 'raw_footage'))
  )
  select id, code, title, did, kind, score, reasons from cand where score > 0 order by score desc, code desc limit 5
$$;

-- -----------------------------------------------------------------------------
-- Storage: one private bucket. Object path:
--   <workspace_id>/<client_id | _shared>/<uuid>/<sanitized-filename>
-- Uploads use TUS (resumable) straight to Storage with the user's JWT; these
-- policies are the authorization boundary for the bytes.
-- -----------------------------------------------------------------------------
create or replace function private.try_uuid(p text)
returns uuid language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;
grant execute on function private.try_uuid(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workspace-files', 'workspace-files', false, 5368709120,
        array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
              'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif', 'image/svg+xml',
              'application/pdf', 'text/plain', 'application/zip',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do nothing;

create policy wf_select on storage.objects for select to authenticated
  using (bucket_id = 'workspace-files' and (
    case when (storage.foldername(name))[2] = '_shared'
         then private.has_perm(private.try_uuid((storage.foldername(name))[1]), 'files.manage')
              or private.is_member(private.try_uuid((storage.foldername(name))[1]))
         else private.can_access_client(private.try_uuid((storage.foldername(name))[1]), private.try_uuid((storage.foldername(name))[2]))
              or exists (select 1 from public.file_assets fa
                          join public.deliverable_version_assets dva on dva.asset_id = fa.id
                         where fa.storage_bucket = 'workspace-files' and fa.storage_path = objects.name
                           and private.can_access_version(dva.version_id))
    end));

create policy wf_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'workspace-files' and private.is_member(private.try_uuid((storage.foldername(name))[1]))
    and (private.has_perm(private.try_uuid((storage.foldername(name))[1]), 'files.upload')
         or private.has_perm(private.try_uuid((storage.foldername(name))[1]), 'files.manage'))
    and (
      ((storage.foldername(name))[2] = '_shared' and private.has_perm(private.try_uuid((storage.foldername(name))[1]), 'files.manage'))
      or private.can_access_client(private.try_uuid((storage.foldername(name))[1]), private.try_uuid((storage.foldername(name))[2]))
      or exists (select 1 from public.tasks t
                  where t.workspace_id = private.try_uuid((storage.foldername(name))[1])
                    and t.client_id = private.try_uuid((storage.foldername(name))[2])
                    and t.assignee_id = (select auth.uid()) and t.status not in ('done', 'cancelled'))));

-- No update/delete policies: originals are never overwritten or removed by users.

-- -----------------------------------------------------------------------------
-- Final grants. Supabase grants EXECUTE to anon by default: revoke and allow
-- only what each role needs.
-- -----------------------------------------------------------------------------
revoke all on all functions in schema public from public, anon;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function
  private.is_member(uuid), private.has_perm(uuid, text), private.can_access_client(uuid, uuid),
  private.is_content_assignee(uuid), private.can_access_content(uuid), private.can_access_deliverable(uuid),
  private.can_access_version(uuid), private.shares_workspace(uuid), private.state_change_allowed(), private.try_uuid(text)
to authenticated;

-- Portal: anonymous clients only reach these four functions.
grant execute on function public.portal_open(text, text) to anon;
grant execute on function public.portal_get(text, text) to anon;
grant execute on function public.portal_respond(text, text, uuid, text, text, text, text, boolean) to anon;
grant execute on function public.portal_bulk_approve(text, text, uuid, text, text, boolean) to anon;
grant execute on function public.portal_finalize(text, text, text) to anon;

-- Cron-only.
revoke execute on function public.run_deadline_scan() from authenticated;
grant execute on function public.run_deadline_scan() to service_role;
