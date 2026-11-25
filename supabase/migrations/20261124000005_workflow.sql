-- =============================================================================
-- Delta Flow — 0005 Workflow engine
--
-- Every state transition lives here, server-side, inside a single transaction.
-- Functions are SECURITY DEFINER and check permissions explicitly against
-- auth.uid(). They lock the rows they change (FOR UPDATE) so concurrent calls
-- serialize, and they are idempotent: re-running the same event never creates
-- duplicate tasks, notifications or decisions.
--
-- Error contract (message prefix => HTTP mapping in the app):
--   permission_denied  403   not_found         404   invalid_transition 409
--   stale_version      409   deliverable_missing 422 comment_required   422
--   approval_required  409   link_unavailable  410   validation        422
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Internal utilities
-- -----------------------------------------------------------------------------
create or replace function private.allow_state_change()
returns void language sql as $$
  select set_config('app.state_change', 'on', true);
$$;

create or replace function private.fail(p_code text, p_detail text default null)
returns void language plpgsql as $$
begin
  raise exception '%', p_code || coalesce(': ' || p_detail, '') using errcode = 'P0001';
end $$;

create or replace function private.user_has_perm(p_ws uuid, p_user uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    join public.member_roles mr on mr.member_id = m.id
    join public.roles r on r.id = mr.role_id
    where m.workspace_id = p_ws and m.user_id = p_user and m.status = 'active'
      and (r.key = 'owner' or exists (select 1 from public.role_permissions rp
                                      where rp.role_id = r.id and rp.permission_key = p_perm))
  )
$$;

-- Managers responsible for a client: tasks.manage AND access to the client.
create or replace function private.managers_of(p_ws uuid, p_client uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct m.user_id
  from public.workspace_members m
  where m.workspace_id = p_ws and m.status = 'active' and m.user_id is not null
    and private.user_has_perm(p_ws, m.user_id, 'tasks.manage')
    and (private.user_has_perm(p_ws, m.user_id, 'clients.view_all')
         or exists (select 1 from public.client_members cm where cm.client_id = p_client and cm.user_id = m.user_id))
$$;

create or replace function private.log_activity(
  p_ws uuid, p_entity_type text, p_entity_id uuid, p_action text,
  p_client uuid default null, p_content uuid default null, p_data jsonb default '{}'::jsonb,
  p_actor_type text default 'user', p_actor_label text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.activity_logs (workspace_id, actor_id, actor_type, actor_label, client_id, content_id,
                                    entity_type, entity_id, action, data)
  values (p_ws, case when p_actor_type = 'user' then auth.uid() end, p_actor_type, p_actor_label,
          p_client, p_content, p_entity_type, p_entity_id, p_action, coalesce(p_data, '{}'::jsonb));
$$;

create or replace function private.audit(p_ws uuid, p_action text, p_entity_type text, p_entity_id uuid, p_data jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, data)
  values (p_ws, auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_data, '{}'::jsonb));
$$;

-- Idempotent notification. Respects in-app preference; enqueues e-mail when
-- the user opted in and the workspace has e-mail enabled.
create or replace function private.notify(
  p_ws uuid, p_user uuid, p_type text, p_category text, p_title text, p_body text,
  p_link text, p_entity_type text, p_entity_id uuid, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_pref record;
  v_id uuid;
begin
  if p_user is null then return; end if;
  select in_app, email into v_pref from public.notification_preferences
   where workspace_id = p_ws and user_id = p_user and category = p_category;
  if coalesce(v_pref.in_app, true) then
    insert into public.notifications (workspace_id, user_id, type, category, title, body, link, entity_type, entity_id, dedupe_key)
    values (p_ws, p_user, p_type, p_category, p_title, p_body, p_link, p_entity_type, p_entity_id, p_dedupe)
    on conflict (user_id, dedupe_key) do nothing
    returning id into v_id;
  end if;
  if coalesce(v_pref.email, false)
     and exists (select 1 from public.workspace_settings s where s.workspace_id = p_ws and s.notify_email_enabled) then
    insert into public.background_jobs (workspace_id, type, payload, idempotency_key)
    values (p_ws, 'send_email',
            jsonb_build_object('user_id', p_user, 'type', p_type, 'title', p_title, 'body', p_body, 'link', p_link),
            'email:' || p_user || ':' || p_dedupe)
    on conflict (idempotency_key) do nothing;
  end if;
end $$;

create or replace function private.notify_managers(
  p_ws uuid, p_client uuid, p_type text, p_category text, p_title text, p_body text,
  p_link text, p_entity_type text, p_entity_id uuid, p_dedupe text, p_except uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  for v_user in select * from private.managers_of(p_ws, p_client) loop
    if v_user is distinct from p_except then
      perform private.notify(p_ws, v_user, p_type, p_category, p_title, p_body, p_link, p_entity_type, p_entity_id, p_dedupe);
    end if;
  end loop;
end $$;

create or replace function private.content_label(p_content uuid)
returns text language sql stable security definer set search_path = '' as $$
  select '#' || c.code || ' ' || c.title from public.content_items c where c.id = p_content
$$;

-- Notify on assignment (insert or reassignment), deduped per assignee.
create or replace function private.on_task_assigned()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and new.assignee_id is distinct from auth.uid()
     and new.status not in ('done', 'cancelled') then
    perform private.notify(new.workspace_id, new.assignee_id, 'task_assigned', 'tasks',
      'Nova tarefa atribuída', new.title,
      '/app/tarefas/' || new.id, 'task', new.id,
      'task_assigned:' || new.id || ':' || new.assignee_id);
  end if;
  return new;
end $$;
create trigger tasks_assigned_notify after insert or update of assignee_id on public.tasks
  for each row execute function private.on_task_assigned();

-- -----------------------------------------------------------------------------
-- Workspace seed (roles, formats, templates)
-- -----------------------------------------------------------------------------
create or replace function private.seed_workspace(p_ws uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_reels uuid; v_reels_ads uuid; v_carousel uuid; v_static uuid; v_role uuid;
  r record;
begin
  -- Roles ---------------------------------------------------------------------
  for r in select * from (values
    ('owner',           'Proprietário',      'Controle integral do workspace', '{}'::public.deliverable_kind[],
       array[]::text[]),
    ('admin',           'Administrador',     'Gestão completa da operação', '{}',
       array['workspace.manage','members.manage','roles.manage','clients.view_all','clients.manage','contents.manage',
             'contents.delete','tasks.manage','tasks.view_all','files.upload','files.manage','approvals.manage',
             'approvals.invalidate','publications.manage','publications.override','integrations.manage','reports.view','audit.view']),
    ('manager',         'Gestora',           'Clientes, conteúdos, tarefas e aprovações', '{}',
       array['clients.view_all','clients.manage','contents.manage','tasks.manage','tasks.view_all','files.upload',
             'files.manage','approvals.manage','approvals.invalidate','publications.manage','reports.view']),
    ('filmmaker',       'Filmmaker',         'Captação e material bruto', '{raw_footage}', array['files.upload']),
    ('editor',          'Editor',            'Edição e ajustes de vídeo', '{video}', array['files.upload']),
    ('designer',        'Designer',          'Capas, imagens e materiais gráficos', '{cover,image,carousel}', array['files.upload']),
    ('copywriter',      'Copywriter',        'Roteiros, textos e legendas', '{script,caption}', array['files.upload']),
    ('social_media',    'Social Media',      'Calendário, agendamentos e publicações', '{}', array['files.upload','publications.manage']),
    ('traffic_manager', 'Gestor de Tráfego', 'Conteúdos autorizados para campanhas', '{}', array[]::text[])
  ) as t(key, name, description, kinds, perms)
  loop
    insert into public.roles (workspace_id, key, name, description, is_system, produces_kinds)
    values (p_ws, r.key, r.name, r.description, true, r.kinds)
    returning id into v_role;
    insert into public.role_permissions (role_id, permission_key)
    select v_role, unnest(r.perms);
  end loop;

  -- Formats ---------------------------------------------------------------------
  insert into public.content_formats (workspace_id, key, name, required_kinds, aspect_ratio, is_system) values
    (p_ws, 'reels',        'Reels',                    '{video,cover,caption}', '9:16', true),
    (p_ws, 'carousel',     'Carrossel',                '{carousel,caption}',    '4:5',  true),
    (p_ws, 'static_post',  'Post estático',            '{image,caption}',       '4:5',  true),
    (p_ws, 'stories',      'Stories',                  '{video}',               '9:16', true),
    (p_ws, 'institutional','Vídeo institucional',      '{video,caption}',       '16:9', true),
    (p_ws, 'ad',           'Anúncio',                  '{video,caption}',       '9:16', true),
    (p_ws, 'paid_creative','Criativo para tráfego pago','{video}',              '9:16', true),
    (p_ws, 'youtube',      'YouTube',                  '{video,cover,caption}', '16:9', true);

  select id into v_reels     from public.content_formats where workspace_id = p_ws and key = 'reels';
  select id into v_reels_ads from public.content_formats where workspace_id = p_ws and key = 'paid_creative';
  select id into v_carousel  from public.content_formats where workspace_id = p_ws and key = 'carousel';
  select id into v_static    from public.content_formats where workspace_id = p_ws and key = 'static_post';

  -- Templates (steps form a DAG: capture -> edit, script -> cover/caption, all -> review)
  insert into public.content_templates (workspace_id, format_id, name, description, is_system, steps) values
  (p_ws, v_reels, 'Reels padrão', 'Roteiro, captação, edição, capa, legenda e revisão', true, '[
    {"key":"script","title":"Roteiro","kind":"production","role_key":"copywriter","deliverable_kind":"script","depends_on":[],"offset_days":1},
    {"key":"capture","title":"Captação","kind":"production","role_key":"filmmaker","deliverable_kind":"raw_footage","depends_on":["script"],"offset_days":3},
    {"key":"edit","title":"Edição","kind":"production","role_key":"editor","deliverable_kind":"video","depends_on":["capture"],"offset_days":5},
    {"key":"cover","title":"Capa","kind":"production","role_key":"designer","deliverable_kind":"cover","depends_on":["script"],"offset_days":5},
    {"key":"caption","title":"Legenda","kind":"production","role_key":"copywriter","deliverable_kind":"caption","depends_on":["script"],"offset_days":4},
    {"key":"review","title":"Revisão interna","kind":"review","role_key":"manager","deliverable_kind":null,"depends_on":["edit","cover","caption"],"offset_days":6}
  ]'::jsonb),
  (p_ws, v_reels_ads, 'Reels para tráfego pago', 'Criativo de vídeo com copy de anúncio', true, '[
    {"key":"script","title":"Roteiro do criativo","kind":"production","role_key":"copywriter","deliverable_kind":"script","depends_on":[],"offset_days":1},
    {"key":"capture","title":"Captação","kind":"production","role_key":"filmmaker","deliverable_kind":"raw_footage","depends_on":["script"],"offset_days":3},
    {"key":"edit","title":"Edição do criativo","kind":"production","role_key":"editor","deliverable_kind":"video","depends_on":["capture"],"offset_days":4},
    {"key":"review","title":"Revisão interna","kind":"review","role_key":"manager","deliverable_kind":null,"depends_on":["edit"],"offset_days":5}
  ]'::jsonb),
  (p_ws, v_carousel, 'Carrossel educativo', 'Roteiro, design dos slides, legenda e revisão', true, '[
    {"key":"script","title":"Roteiro dos slides","kind":"production","role_key":"copywriter","deliverable_kind":"script","depends_on":[],"offset_days":1},
    {"key":"design","title":"Design do carrossel","kind":"production","role_key":"designer","deliverable_kind":"carousel","depends_on":["script"],"offset_days":3},
    {"key":"caption","title":"Legenda","kind":"production","role_key":"copywriter","deliverable_kind":"caption","depends_on":["script"],"offset_days":2},
    {"key":"review","title":"Revisão interna","kind":"review","role_key":"manager","deliverable_kind":null,"depends_on":["design","caption"],"offset_days":4}
  ]'::jsonb),
  (p_ws, v_static, 'Post institucional', 'Arte e legenda', true, '[
    {"key":"design","title":"Arte","kind":"production","role_key":"designer","deliverable_kind":"image","depends_on":[],"offset_days":2},
    {"key":"caption","title":"Legenda","kind":"production","role_key":"copywriter","deliverable_kind":"caption","depends_on":[],"offset_days":2},
    {"key":"review","title":"Revisão interna","kind":"review","role_key":"manager","deliverable_kind":null,"depends_on":["design","caption"],"offset_days":3}
  ]'::jsonb),
  (p_ws, v_static, 'Campanha promocional', 'Peça promocional com legenda de oferta', true, '[
    {"key":"script","title":"Conceito da oferta","kind":"production","role_key":"copywriter","deliverable_kind":"script","depends_on":[],"offset_days":1},
    {"key":"design","title":"Arte promocional","kind":"production","role_key":"designer","deliverable_kind":"image","depends_on":["script"],"offset_days":2},
    {"key":"caption","title":"Legenda da oferta","kind":"production","role_key":"copywriter","deliverable_kind":"caption","depends_on":["script"],"offset_days":2},
    {"key":"review","title":"Revisão interna","kind":"review","role_key":"manager","deliverable_kind":null,"depends_on":["design","caption"],"offset_days":3}
  ]'::jsonb);
end $$;

-- -----------------------------------------------------------------------------
-- Workspace & membership RPCs
-- -----------------------------------------------------------------------------
create or replace function public.create_workspace(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_member uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then perform private.fail('permission_denied', 'authentication required'); end if;
  if char_length(coalesce(btrim(p_name), '')) < 2 then perform private.fail('validation', 'name'); end if;
  if exists (select 1 from public.workspaces where slug = lower(p_slug)) then
    perform private.fail('validation', 'slug_taken');
  end if;

  insert into public.workspaces (name, slug, created_by) values (btrim(p_name), lower(p_slug), v_uid) returning id into v_ws;
  insert into public.workspace_settings (workspace_id) values (v_ws);
  insert into public.workspace_members (workspace_id, user_id, status, joined_at)
  values (v_ws, v_uid, 'active', now()) returning id into v_member;
  perform private.seed_workspace(v_ws);
  insert into public.member_roles (workspace_id, member_id, role_id)
  select v_ws, v_member, id from public.roles where workspace_id = v_ws and key = 'owner';
  perform private.audit(v_ws, 'workspace.created', 'workspace', v_ws, jsonb_build_object('name', p_name));
  return v_ws;
end $$;

create or replace function public.accept_pending_invites()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_email text; v_count integer;
begin
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is null then return 0; end if;
  update public.workspace_members m
     set user_id = auth.uid(), status = 'active', joined_at = now()
   where m.user_id is null and m.status = 'invited' and lower(m.invited_email) = v_email
     and not exists (select 1 from public.workspace_members x where x.workspace_id = m.workspace_id and x.user_id = auth.uid());
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.invite_member(p_ws uuid, p_email text, p_role_keys text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_member uuid;
begin
  perform private.require_perm(p_ws, 'members.manage');
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform private.fail('validation', 'email'); end if;
  if 'owner' = any(p_role_keys) and not exists (
       select 1 from public.workspace_members m join public.member_roles mr on mr.member_id = m.id
       join public.roles r on r.id = mr.role_id
       where m.workspace_id = p_ws and m.user_id = auth.uid() and r.key = 'owner') then
    perform private.fail('permission_denied', 'only owners grant owner');
  end if;
  if exists (select 1 from public.workspace_members m join auth.users u on u.id = m.user_id
             where m.workspace_id = p_ws and lower(u.email) = lower(p_email)) then
    perform private.fail('validation', 'already_member');
  end if;

  insert into public.workspace_members (workspace_id, invited_email, invited_by, status)
  values (p_ws, lower(p_email), auth.uid(), 'invited')
  on conflict (workspace_id, lower(invited_email)) where user_id is null do update set invited_by = excluded.invited_by
  returning id into v_member;

  delete from public.member_roles where member_id = v_member;
  insert into public.member_roles (workspace_id, member_id, role_id)
  select p_ws, v_member, r.id from public.roles r where r.workspace_id = p_ws and r.key = any(p_role_keys);
  if not found then perform private.fail('validation', 'roles'); end if;

  perform private.audit(p_ws, 'member.invited', 'member', v_member, jsonb_build_object('email', lower(p_email), 'roles', p_role_keys));
  return v_member;
end $$;

create or replace function public.set_member_roles(p_ws uuid, p_member uuid, p_role_keys text[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_was_owner boolean; v_will_owner boolean; v_caller_owner boolean;
begin
  perform private.require_perm(p_ws, 'members.manage');
  if not exists (select 1 from public.workspace_members where id = p_member and workspace_id = p_ws) then
    perform private.fail('not_found', 'member');
  end if;
  select exists (select 1 from public.member_roles mr join public.roles r on r.id = mr.role_id
                 where mr.member_id = p_member and r.key = 'owner') into v_was_owner;
  v_will_owner := 'owner' = any(p_role_keys);
  select exists (select 1 from public.workspace_members m join public.member_roles mr on mr.member_id = m.id
                 join public.roles r on r.id = mr.role_id
                 where m.workspace_id = p_ws and m.user_id = auth.uid() and r.key = 'owner') into v_caller_owner;
  if (v_was_owner <> v_will_owner) and not v_caller_owner then
    perform private.fail('permission_denied', 'only owners change ownership');
  end if;
  if v_was_owner and not v_will_owner and (
     select count(*) from public.member_roles mr join public.roles r on r.id = mr.role_id
      join public.workspace_members m on m.id = mr.member_id
      where r.workspace_id = p_ws and r.key = 'owner' and m.status = 'active') <= 1 then
    perform private.fail('invalid_transition', 'workspace needs at least one owner');
  end if;
  delete from public.member_roles where member_id = p_member;
  insert into public.member_roles (workspace_id, member_id, role_id)
  select p_ws, p_member, r.id from public.roles r where r.workspace_id = p_ws and r.key = any(p_role_keys);
  perform private.audit(p_ws, 'member.roles_changed', 'member', p_member, jsonb_build_object('roles', p_role_keys));
end $$;

create or replace function public.set_member_status(p_ws uuid, p_member uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  perform private.require_perm(p_ws, 'members.manage');
  select user_id into v_user from public.workspace_members where id = p_member and workspace_id = p_ws for update;
  if not found then perform private.fail('not_found', 'member'); end if;
  if v_user = auth.uid() then perform private.fail('invalid_transition', 'cannot change own status'); end if;
  if not p_active and exists (select 1 from public.member_roles mr join public.roles r on r.id = mr.role_id
                              where mr.member_id = p_member and r.key = 'owner') then
    perform private.fail('invalid_transition', 'owners cannot be disabled');
  end if;
  update public.workspace_members
     set status = case when p_active then 'active'::public.member_status else 'disabled'::public.member_status end,
         disabled_at = case when p_active then null else now() end
   where id = p_member;
  perform private.audit(p_ws, case when p_active then 'member.enabled' else 'member.disabled' end, 'member', p_member);
end $$;

create or replace function public.my_permissions(p_ws uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct p.key order by p.key), '{}')
  from public.permissions p
  where private.has_perm(p_ws, p.key)
$$;

-- -----------------------------------------------------------------------------
-- Content status derivation (single source of truth)
-- -----------------------------------------------------------------------------
create or replace function private.recompute_content(p_content uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c                public.content_items%rowtype;
  v_req            integer; v_req_versioned integer;
  v_cf             integer; v_cf_approved integer; v_cf_rejected integer;
  v_sent           boolean; v_open_rev integer; v_open_review integer;
  v_progress       boolean; v_next_kind public.deliverable_kind; v_next_step text;
  v_prod           public.production_status;
  v_appr           public.approval_status;
  v_pub            public.publication_status;
  v_stage          public.content_stage;
begin
  select * into c from public.content_items where id = p_content for update;
  if not found then return; end if;

  select count(*) filter (where d.required),
         count(*) filter (where d.required and d.current_version_id is not null),
         count(*) filter (where d.required and d.client_facing),
         count(*) filter (where d.required and d.client_facing and d.approval_status = 'approved'),
         count(*) filter (where d.required and d.client_facing and d.approval_status = 'rejected')
    into v_req, v_req_versioned, v_cf, v_cf_approved, v_cf_rejected
  from public.deliverables d where d.content_id = p_content;

  select exists (select 1 from public.approval_batch_items i where i.content_id = p_content) into v_sent;
  select count(*) into v_open_rev from public.revision_requests r where r.content_id = p_content and r.status = 'open';
  select count(*) into v_open_review from public.tasks t
   where t.content_id = p_content and t.kind = 'review' and t.status not in ('done', 'cancelled');
  select exists (select 1 from public.tasks t where t.content_id = p_content and t.status in ('in_progress', 'in_review', 'done'))
      or exists (select 1 from public.deliverables d where d.content_id = p_content and d.current_version_id is not null)
    into v_progress;

  -- Production
  if v_open_rev > 0 then v_prod := 'adjustments';
  elsif v_req > 0 and v_req_versioned = v_req then
    v_prod := case when v_open_review > 0 then 'internal_review' else 'done' end;
  elsif v_progress then v_prod := 'in_production';
  else v_prod := 'planned';
  end if;

  -- Approval (client-facing required deliverables only)
  if v_cf = 0 then
    v_appr := case when v_prod = 'done' then 'approved' else 'not_sent' end;
  elsif not v_sent then v_appr := 'not_sent';
  elsif v_cf_approved = v_cf then v_appr := 'approved';
  elsif v_cf_rejected > 0 then v_appr := 'rejected';
  elsif v_cf_approved > 0 then v_appr := 'partially_approved';
  else v_appr := 'awaiting';
  end if;

  -- Publication (published / cancelled / scheduled are sticky, set explicitly)
  if c.publication_status in ('published', 'cancelled', 'scheduled') then
    v_pub := c.publication_status;
  elsif v_appr = 'approved' and v_prod = 'done' then v_pub := 'ready';
  elsif c.planned_publish_at is not null then v_pub := 'planned';
  else v_pub := 'unscheduled';
  end if;

  -- Stage shown in the pipeline board
  if v_pub = 'cancelled' then v_stage := 'cancelled';
  elsif v_pub = 'published' then v_stage := 'published';
  elsif v_pub = 'scheduled' then v_stage := 'scheduled';
  elsif v_pub = 'ready' then v_stage := 'ready';
  elsif v_prod = 'adjustments' then v_stage := 'adjustments';
  elsif v_appr in ('awaiting', 'partially_approved', 'rejected') then v_stage := 'client_approval';
  elsif v_prod = 'internal_review' then v_stage := 'internal_review';
  elsif v_prod = 'done' then v_stage := 'client_approval';   -- reviewed, waiting to be sent
  else
    select d.kind, t.step_key into v_next_kind, v_next_step
      from public.tasks t left join public.deliverables d on d.id = t.deliverable_id
     where t.content_id = p_content and t.kind = 'production' and t.status not in ('done', 'cancelled')
     -- Most upstream open step in pipeline order (parallel work shows the earliest stage).
     order by case t.status when 'blocked' then 1 else 0 end,
              case d.kind when 'script' then 1 when 'raw_footage' then 2 when 'video' then 3
                          when 'cover' then 4 when 'image' then 4 when 'carousel' then 4 when 'caption' then 5 else 6 end,
              t.due_at nulls last, t.created_at
     limit 1;
    v_stage := case
      when v_next_kind = 'script' then 'script'
      when v_next_kind = 'raw_footage' then 'capture'
      when v_next_kind = 'video' then 'editing'
      when v_next_kind in ('cover', 'image', 'carousel') then 'cover'
      when v_next_kind = 'caption' then 'caption'
      when v_progress then 'internal_review'
      else 'planning' end;
  end if;

  if (c.production_status, c.approval_status, c.publication_status, c.stage)
     is distinct from (v_prod, v_appr, v_pub, v_stage) then
    perform private.allow_state_change();
    update public.content_items
       set production_status = v_prod, approval_status = v_appr, publication_status = v_pub, stage = v_stage
     where id = p_content;

    if c.approval_status = 'approved' and v_appr <> 'approved' and c.publication_status = 'scheduled' then
      perform private.notify_managers(c.workspace_id, c.client_id, 'scheduled_lost_approval', 'publications',
        'Conteúdo agendado perdeu a aprovação', private.content_label(p_content),
        '/app/conteudos/' || p_content, 'content', p_content,
        'scheduled_lost_approval:' || p_content || ':' || c.lock_version);
    end if;
    if c.approval_status <> 'approved' and v_appr = 'approved' and v_sent then
      perform private.notify_managers(c.workspace_id, c.client_id, 'content_approved', 'approvals',
        'Conteúdo aprovado pelo cliente', private.content_label(p_content),
        '/app/conteudos/' || p_content, 'content', p_content,
        'content_approved:' || p_content || ':' || c.lock_version);
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Contents
-- -----------------------------------------------------------------------------
-- p_fields: { service_id, template_id, objective, description, briefing, script,
--             priority, due_at, planned_publish_at, channel }
-- p_assignees: { "<step_key>": "<user uuid>" }
create or replace function public.create_content(
  p_ws uuid, p_client uuid, p_format uuid, p_title text,
  p_fields jsonb default '{}'::jsonb, p_assignees jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_content uuid; v_code integer; v_template public.content_templates%rowtype;
  v_format public.content_formats%rowtype; v_step jsonb; v_dep text;
  v_deliv uuid; v_task uuid; v_kind public.deliverable_kind; v_assignee uuid;
  v_base timestamptz := now(); v_steps jsonb := '[]'::jsonb; v_task_ids jsonb := '{}'::jsonb;
  v_template_id uuid := nullif(p_fields ->> 'template_id', '')::uuid;
  v_position integer := 0;
begin
  perform private.require_perm(p_ws, 'contents.manage');
  if not private.can_access_client(p_ws, p_client) then perform private.fail('permission_denied', 'client'); end if;
  if char_length(coalesce(btrim(p_title), '')) = 0 then perform private.fail('validation', 'title'); end if;
  if not exists (select 1 from public.clients where id = p_client and workspace_id = p_ws and status <> 'archived') then
    perform private.fail('not_found', 'client');
  end if;

  select * into v_format from public.content_formats where id = p_format and workspace_id = p_ws and active;
  if not found then perform private.fail('not_found', 'format'); end if;

  if v_template_id is not null then
    select * into v_template from public.content_templates where id = v_template_id and workspace_id = p_ws and active;
    if not found then perform private.fail('not_found', 'template'); end if;
    if v_template.format_id <> p_format then perform private.fail('validation', 'template_format_mismatch'); end if;
    v_steps := v_template.steps;
  end if;

  update public.workspaces set content_counter = content_counter + 1 where id = p_ws returning content_counter into v_code;

  insert into public.content_items (
    workspace_id, client_id, service_id, format_id, template_id, code, title, objective, description, briefing,
    script, priority, due_at, planned_publish_at, channel, publication_status, created_by)
  values (
    p_ws, p_client, nullif(p_fields ->> 'service_id', '')::uuid, p_format, v_template_id, v_code, btrim(p_title),
    p_fields ->> 'objective', p_fields ->> 'description', p_fields ->> 'briefing', p_fields ->> 'script',
    coalesce(nullif(p_fields ->> 'priority', '')::public.priority_level, 'medium'),
    nullif(p_fields ->> 'due_at', '')::timestamptz,
    nullif(p_fields ->> 'planned_publish_at', '')::timestamptz,
    nullif(p_fields ->> 'channel', ''),
    case when nullif(p_fields ->> 'planned_publish_at', '') is not null then 'planned'::public.publication_status
         else 'unscheduled'::public.publication_status end,
    auth.uid())
  returning id into v_content;

  perform private.allow_state_change();

  if jsonb_array_length(v_steps) > 0 then
    for v_step in select * from jsonb_array_elements(v_steps) loop
      v_kind := nullif(v_step ->> 'deliverable_kind', '')::public.deliverable_kind;
      v_assignee := nullif(p_assignees ->> (v_step ->> 'key'), '')::uuid;
      if v_assignee is not null and not exists (
           select 1 from public.workspace_members where workspace_id = p_ws and user_id = v_assignee and status = 'active') then
        perform private.fail('validation', 'assignee_not_member');
      end if;
      v_deliv := null;
      if v_kind is not null then
        insert into public.deliverables (workspace_id, content_id, kind, title, required, client_facing,
                                         responsible_role_key, assignee_id, position)
        values (p_ws, v_content, v_kind, v_step ->> 'title', true,
                v_kind in ('video', 'cover', 'caption', 'image', 'carousel'),
                v_step ->> 'role_key', v_assignee, v_position)
        returning id into v_deliv;
        v_position := v_position + 1;
      end if;
      insert into public.tasks (workspace_id, client_id, content_id, deliverable_id, step_key, kind, title,
                                required_role_key, assignee_id, due_at, priority, status, created_by)
      values (p_ws, p_client, v_content, v_deliv, v_step ->> 'key',
              coalesce(nullif(v_step ->> 'kind', ''), 'production')::public.task_kind,
              (v_step ->> 'title') || ' — ' || btrim(p_title),
              v_step ->> 'role_key', v_assignee,
              v_base + make_interval(days => coalesce((v_step ->> 'offset_days')::integer, 0)),
              coalesce(nullif(p_fields ->> 'priority', '')::public.priority_level, 'medium'),
              case when jsonb_array_length(coalesce(v_step -> 'depends_on', '[]'::jsonb)) > 0
                   then 'blocked'::public.task_status else 'pending'::public.task_status end,
              auth.uid())
      returning id into v_task;
      v_task_ids := v_task_ids || jsonb_build_object(v_step ->> 'key', v_task);
    end loop;

    for v_step in select * from jsonb_array_elements(v_steps) loop
      for v_dep in select * from jsonb_array_elements_text(coalesce(v_step -> 'depends_on', '[]'::jsonb)) loop
        if v_task_ids ->> v_dep is null then perform private.fail('validation', 'template_dependency ' || v_dep); end if;
        insert into public.task_dependencies (workspace_id, task_id, depends_on_task_id)
        values (p_ws, (v_task_ids ->> (v_step ->> 'key'))::uuid, (v_task_ids ->> v_dep)::uuid);
      end loop;
    end loop;
  else
    -- No template: create the format's required deliverables, no tasks.
    for v_kind in select unnest(v_format.required_kinds) loop
      insert into public.deliverables (workspace_id, content_id, kind, title, required, client_facing, position,
                                       responsible_role_key)
      values (p_ws, v_content, v_kind,
              case v_kind when 'video' then 'Vídeo' when 'cover' then 'Capa' when 'caption' then 'Legenda'
                          when 'image' then 'Arte' when 'carousel' then 'Carrossel' else initcap(v_kind::text) end,
              true, v_kind in ('video', 'cover', 'caption', 'image', 'carousel'), v_position,
              case v_kind when 'video' then 'editor' when 'caption' then 'copywriter' else 'designer' end);
      v_position := v_position + 1;
    end loop;
  end if;

  perform private.log_activity(p_ws, 'content', v_content, 'content.created', p_client, v_content,
                               jsonb_build_object('title', p_title, 'template_id', v_template_id));
  perform private.recompute_content(v_content);
  return v_content;
end $$;

create or replace function public.duplicate_content(p_content uuid, p_title text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.content_items%rowtype; v_new uuid; v_assignees jsonb;
begin
  select * into c from public.content_items where id = p_content;
  if not found or not private.can_access_content(p_content) then perform private.fail('not_found', 'content'); end if;
  select coalesce(jsonb_object_agg(t.step_key, t.assignee_id) filter (where t.step_key is not null and t.assignee_id is not null), '{}')
    into v_assignees from public.tasks t where t.content_id = p_content and t.kind <> 'adjustment';
  v_new := public.create_content(c.workspace_id, c.client_id, c.format_id, coalesce(p_title, c.title || ' (cópia)'),
    jsonb_build_object('service_id', c.service_id, 'template_id', c.template_id, 'objective', c.objective,
                       'description', c.description, 'briefing', c.briefing, 'script', c.script,
                       'priority', c.priority, 'channel', c.channel),
    v_assignees);
  perform private.log_activity(c.workspace_id, 'content', v_new, 'content.duplicated', c.client_id, v_new,
                               jsonb_build_object('source', p_content));
  return v_new;
end $$;

-- -----------------------------------------------------------------------------
-- Tasks
-- -----------------------------------------------------------------------------
create or replace function private.lock_task_for_actor(p_task uuid)
returns public.tasks language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found then perform private.fail('not_found', 'task'); end if;
  if not private.is_member(t.workspace_id) then perform private.fail('not_found', 'task'); end if;
  if not (t.assignee_id = auth.uid()
          or (private.has_perm(t.workspace_id, 'tasks.manage') and private.can_access_client(t.workspace_id, t.client_id))) then
    perform private.fail('permission_denied', 'task');
  end if;
  return t;
end $$;

create or replace function public.start_task(p_task uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype;
begin
  t := private.lock_task_for_actor(p_task);
  if t.status = 'in_progress' then return; end if;
  if t.status = 'blocked' then perform private.fail('invalid_transition', 'dependencies_pending'); end if;
  if t.status not in ('pending', 'reopened', 'in_review') then perform private.fail('invalid_transition', t.status::text); end if;
  perform private.allow_state_change();
  update public.tasks set status = 'in_progress', started_at = coalesce(started_at, now()) where id = p_task;
  perform private.log_activity(t.workspace_id, 'task', t.id, 'task.started', t.client_id, t.content_id);
  if t.content_id is not null then perform private.recompute_content(t.content_id); end if;
end $$;

-- Does the task's mandatory deliverable exist? (file, link or text)
create or replace function private.task_deliverable_ready(t public.tasks)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_current integer; v_rejected integer;
begin
  if t.deliverable_id is null then return true; end if;
  select v.version_number into v_current
    from public.deliverables d join public.deliverable_versions v on v.id = d.current_version_id
   where d.id = t.deliverable_id;
  if v_current is null then return false; end if;
  if t.kind = 'adjustment' and t.revision_request_id is not null then
    select v.version_number into v_rejected
      from public.revision_requests r join public.deliverable_versions v on v.id = r.version_id
     where r.id = t.revision_request_id;
    return v_current > coalesce(v_rejected, 0);
  end if;
  return true;
end $$;

create or replace function public.send_task_to_review(p_task uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype;
begin
  t := private.lock_task_for_actor(p_task);
  if t.status = 'in_review' then return; end if;
  if t.status not in ('pending', 'in_progress', 'reopened') then perform private.fail('invalid_transition', t.status::text); end if;
  if not private.task_deliverable_ready(t) then perform private.fail('deliverable_missing'); end if;
  perform private.allow_state_change();
  update public.tasks set status = 'in_review', started_at = coalesce(started_at, now()) where id = p_task;
  perform private.notify_managers(t.workspace_id, t.client_id, 'task_in_review', 'tasks', 'Tarefa aguardando revisão',
    t.title, '/app/tarefas/' || t.id, 'task', t.id, 'task_in_review:' || t.id || ':' || t.reopen_count, auth.uid());
  perform private.log_activity(t.workspace_id, 'task', t.id, 'task.sent_to_review', t.client_id, t.content_id);
end $$;

create or replace function private.release_dependents(t public.tasks)
returns void language plpgsql security definer set search_path = '' as $$
declare dep public.tasks%rowtype;
begin
  for dep in
    select t2.* from public.task_dependencies d join public.tasks t2 on t2.id = d.task_id
     where d.depends_on_task_id = t.id and t2.status = 'blocked'
     for update of t2
  loop
    if not exists (select 1 from public.task_dependencies d2 join public.tasks t3 on t3.id = d2.depends_on_task_id
                   where d2.task_id = dep.id and t3.status not in ('done', 'cancelled')) then
      update public.tasks set status = 'pending' where id = dep.id;
      perform private.log_activity(dep.workspace_id, 'task', dep.id, 'task.released', dep.client_id, dep.content_id);
      if dep.kind = 'review' then
        perform private.notify_managers(dep.workspace_id, dep.client_id, 'review_ready', 'tasks',
          'Conteúdo pronto para revisão interna', private.content_label(dep.content_id),
          '/app/conteudos/' || dep.content_id, 'task', dep.id, 'review_ready:' || dep.id || ':' || dep.reopen_count);
      end if;
      if dep.assignee_id is not null then
        perform private.notify(dep.workspace_id, dep.assignee_id, 'task_released', 'tasks', 'Tarefa liberada',
          dep.title, '/app/tarefas/' || dep.id, 'task', dep.id, 'task_released:' || dep.id || ':' || dep.reopen_count);
      elsif dep.kind <> 'review' then
        perform private.notify_managers(dep.workspace_id, dep.client_id, 'task_released_unassigned', 'tasks',
          'Tarefa liberada sem responsável', dep.title, '/app/tarefas/' || dep.id, 'task', dep.id,
          'task_released_unassigned:' || dep.id || ':' || dep.reopen_count);
      end if;
    end if;
  end loop;
end $$;

create or replace function public.complete_task(p_task uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks%rowtype; v_review public.tasks%rowtype; v_missing integer;
begin
  t := private.lock_task_for_actor(p_task);
  if t.status = 'done' then return; end if;                                   -- idempotent
  if t.status = 'blocked' then perform private.fail('invalid_transition', 'dependencies_pending'); end if;
  if t.status = 'cancelled' then perform private.fail('invalid_transition', 'cancelled'); end if;
  -- Producers complete their own work; only managers approve something sitting in review.
  if t.status = 'in_review' and not private.has_perm(t.workspace_id, 'tasks.manage') then
    perform private.fail('permission_denied', 'review requires tasks.manage');
  end if;

  if t.kind in ('production', 'adjustment') and not private.task_deliverable_ready(t) then
    perform private.fail('deliverable_missing');
  end if;

  perform private.allow_state_change();

  if t.kind = 'review' then
    if not private.has_perm(t.workspace_id, 'tasks.manage') then
      perform private.fail('permission_denied', 'review requires tasks.manage');
    end if;
    select count(*) into v_missing from public.deliverables d
     where d.content_id = t.content_id and d.required and d.current_version_id is null;
    if v_missing > 0 then perform private.fail('deliverable_missing', v_missing || ' entregável(is) obrigatório(s)'); end if;
    if exists (select 1 from public.revision_requests r where r.content_id = t.content_id and r.status = 'open') then
      perform private.fail('invalid_transition', 'adjustments_pending');
    end if;
    -- Release current versions of client-facing deliverables to the portal.
    update public.deliverable_versions v set released_at = now(), released_by = auth.uid()
      from public.deliverables d
     where d.content_id = t.content_id and d.client_facing and v.id = d.current_version_id and v.released_at is null;
  end if;

  update public.tasks set status = 'done', completed_at = now(), completed_by = auth.uid(),
                          started_at = coalesce(started_at, now())
   where id = p_task;
  t.status := 'done';

  perform private.release_dependents(t);

  if t.kind = 'adjustment' and t.revision_request_id is not null then
    update public.revision_requests set status = 'resolved', resolved_at = now()
     where id = t.revision_request_id and status = 'open';
    -- Re-open internal review (only the affected content goes back to review).
    select * into v_review from public.tasks
     where content_id = t.content_id and kind = 'review' and status <> 'cancelled'
     order by created_at limit 1 for update;
    if found then
      if v_review.status = 'done' then
        update public.tasks set status = 'reopened', reopen_count = reopen_count + 1, completed_at = null, completed_by = null
         where id = v_review.id;
        v_review.reopen_count := v_review.reopen_count + 1;
      end if;
    else
      insert into public.tasks (workspace_id, client_id, content_id, step_key, kind, title, required_role_key, status, due_at, created_by)
      values (t.workspace_id, t.client_id, t.content_id, 'review', 'review',
              'Revisão interna — ' || (select title from public.content_items where id = t.content_id),
              'manager', 'pending', now() + interval '1 day', auth.uid())
      returning * into v_review;
    end if;
    if not exists (select 1 from public.revision_requests where content_id = t.content_id and status = 'open') then
      perform private.notify_managers(t.workspace_id, t.client_id, 'review_ready', 'tasks',
        'Ajuste concluído: revisar nova versão', private.content_label(t.content_id),
        '/app/conteudos/' || t.content_id, 'task', v_review.id, 'review_ready:' || v_review.id || ':' || v_review.reopen_count);
    end if;
  end if;

  perform private.log_activity(t.workspace_id, 'task', t.id, 'task.completed', t.client_id, t.content_id,
                               jsonb_build_object('kind', t.kind, 'step', t.step_key));
  if t.content_id is not null then perform private.recompute_content(t.content_id); end if;
end $$;

create or replace function public.reopen_task(p_task uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found or not private.is_member(t.workspace_id) then perform private.fail('not_found', 'task'); end if;
  perform private.require_perm(t.workspace_id, 'tasks.manage');
  if t.status not in ('done', 'in_review', 'cancelled') then perform private.fail('invalid_transition', t.status::text); end if;
  if char_length(coalesce(btrim(p_reason), '')) < 3 then perform private.fail('comment_required'); end if;
  perform private.allow_state_change();
  update public.tasks set status = 'reopened', reopen_count = reopen_count + 1, completed_at = null, completed_by = null
   where id = p_task;
  if t.assignee_id is not null then
    perform private.notify(t.workspace_id, t.assignee_id, 'task_reopened', 'tasks', 'Tarefa reaberta: ajuste solicitado',
      p_reason, '/app/tarefas/' || t.id, 'task', t.id, 'task_reopened:' || t.id || ':' || (t.reopen_count + 1));
  end if;
  insert into public.comments (workspace_id, content_id, task_id, author_id, body)
  select t.workspace_id, t.content_id, t.id, auth.uid(), 'Tarefa reaberta: ' || p_reason where t.content_id is not null;
  perform private.log_activity(t.workspace_id, 'task', t.id, 'task.reopened', t.client_id, t.content_id,
                               jsonb_build_object('reason', p_reason));
  if t.content_id is not null then perform private.recompute_content(t.content_id); end if;
end $$;

create or replace function public.cancel_task(p_task uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype;
begin
  select * into t from public.tasks where id = p_task for update;
  if not found or not private.is_member(t.workspace_id) then perform private.fail('not_found', 'task'); end if;
  perform private.require_perm(t.workspace_id, 'tasks.manage');
  if t.status in ('done', 'cancelled') then return; end if;
  perform private.allow_state_change();
  update public.tasks set status = 'cancelled' where id = p_task;
  perform private.release_dependents(t);  -- cancelled dependencies no longer block
  perform private.log_activity(t.workspace_id, 'task', t.id, 'task.cancelled', t.client_id, t.content_id,
                               jsonb_build_object('reason', p_reason));
  if t.content_id is not null then perform private.recompute_content(t.content_id); end if;
end $$;

-- -----------------------------------------------------------------------------
-- Versions
-- -----------------------------------------------------------------------------
create or replace function public.add_deliverable_version(
  p_deliverable uuid, p_text text default null, p_asset_ids uuid[] default '{}',
  p_external_url text default null, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  d public.deliverables%rowtype; c public.content_items%rowtype;
  v_prev public.deliverable_versions%rowtype; v_next integer; v_version uuid;
  v_allowed boolean; v_asset_count integer;
begin
  select * into d from public.deliverables where id = p_deliverable for update;
  if not found or not private.can_access_deliverable(p_deliverable) then perform private.fail('not_found', 'deliverable'); end if;
  select * into c from public.content_items where id = d.content_id;

  v_allowed := (private.has_perm(d.workspace_id, 'contents.manage') and private.can_access_client(d.workspace_id, c.client_id))
            or (private.has_perm(d.workspace_id, 'files.upload') and (
                  d.assignee_id = auth.uid()
               or exists (select 1 from public.tasks t where t.deliverable_id = d.id and t.assignee_id = auth.uid()
                          and t.status not in ('done', 'cancelled'))));
  if not v_allowed then perform private.fail('permission_denied', 'deliverable'); end if;
  if c.publication_status = 'published' then perform private.fail('invalid_transition', 'content_published'); end if;

  p_asset_ids := coalesce(p_asset_ids, '{}');
  p_text := nullif(btrim(coalesce(p_text, '')), '');
  p_external_url := nullif(btrim(coalesce(p_external_url, '')), '');
  if p_external_url is not null and p_external_url !~* '^https://' then perform private.fail('validation', 'url'); end if;

  select count(*) into v_asset_count from public.file_assets a
   where a.id = any(p_asset_ids) and a.workspace_id = d.workspace_id
     and (a.client_id is null or a.client_id = c.client_id) and a.archived_at is null;
  if v_asset_count <> coalesce(array_length(p_asset_ids, 1), 0) then perform private.fail('validation', 'assets'); end if;

  if d.kind in ('caption', 'script') then
    if p_text is null and v_asset_count = 0 and p_external_url is null then perform private.fail('deliverable_missing', 'text'); end if;
  elsif v_asset_count = 0 and p_external_url is null then
    perform private.fail('deliverable_missing', 'file');
  end if;

  if d.current_version_id is not null then
    select * into v_prev from public.deliverable_versions where id = d.current_version_id;
    if v_prev.status = 'approved' and char_length(coalesce(btrim(p_reason), '')) < 3 then
      perform private.fail('comment_required', 'reason for replacing an approved version');
    end if;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next from public.deliverable_versions where deliverable_id = d.id;

  perform private.allow_state_change();
  insert into public.deliverable_versions (workspace_id, deliverable_id, version_number, text_content, external_url,
                                           author_id, change_reason)
  values (d.workspace_id, d.id, v_next, p_text, p_external_url, auth.uid(), nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_version;

  insert into public.deliverable_version_assets (workspace_id, version_id, asset_id, position)
  select d.workspace_id, v_version, a.id, (a.ord - 1)::smallint from unnest(p_asset_ids) with ordinality as a(id, ord);

  if v_prev.id is not null and v_prev.status = 'pending' then
    update public.deliverable_versions set status = 'superseded' where id = v_prev.id;
  end if;
  update public.deliverables set current_version_id = v_version, approval_status = 'pending' where id = d.id;

  -- Thumbnail for gallery views: prefer cover, then image/carousel first slide.
  if d.kind in ('cover', 'image', 'carousel') and v_asset_count > 0 and
     (c.thumbnail_asset_id is null or d.kind = 'cover') then
    update public.content_items set thumbnail_asset_id = p_asset_ids[1] where id = c.id;
  end if;

  if v_prev.status = 'approved' then
    perform private.audit(d.workspace_id, 'approval.reset_by_new_version', 'deliverable', d.id,
                          jsonb_build_object('previous_version', v_prev.version_number, 'new_version', v_next, 'reason', p_reason));
  end if;
  perform private.log_activity(d.workspace_id, 'deliverable', d.id, 'version.created', c.client_id, c.id,
                               jsonb_build_object('kind', d.kind, 'version', v_next, 'reason', p_reason));
  perform private.notify_managers(d.workspace_id, c.client_id, 'version_uploaded', 'files', 'Nova versão enviada',
    d.title || ' V' || v_next || ' · ' || private.content_label(c.id), '/app/conteudos/' || c.id,
    'deliverable', d.id, 'version_uploaded:' || v_version, auth.uid());
  perform private.recompute_content(c.id);
  return v_version;
end $$;

-- Adjustment task for a revision request (idempotent through unique indexes).
create or replace function private.create_adjustment_task(p_revision uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  r public.revision_requests%rowtype; d public.deliverables%rowtype; c public.content_items%rowtype;
  v_assignee uuid; v_task uuid;
begin
  select * into r from public.revision_requests where id = p_revision for update;
  if r.task_id is not null then return r.task_id; end if;
  select * into d from public.deliverables where id = r.deliverable_id;
  select * into c from public.content_items where id = r.content_id;

  v_assignee := d.assignee_id;
  if v_assignee is null then
    select t.assignee_id into v_assignee from public.tasks t
     where t.deliverable_id = d.id and t.assignee_id is not null and t.kind in ('production', 'adjustment')
     order by t.completed_at desc nulls last, t.created_at desc limit 1;
  end if;

  perform private.allow_state_change();
  insert into public.tasks (workspace_id, client_id, content_id, deliverable_id, step_key, kind, title, description,
                            required_role_key, assignee_id, due_at, priority, status, revision_request_id)
  values (r.workspace_id, c.client_id, c.id, d.id, 'adjust_' || d.kind, 'adjustment',
          'Ajuste: ' || d.title || ' — ' || c.title, r.reason, d.responsible_role_key, v_assignee,
          now() + interval '2 days', 'high', 'pending', r.id)
  on conflict (revision_request_id) where revision_request_id is not null do nothing
  returning id into v_task;
  if v_task is null then
    select id into v_task from public.tasks where revision_request_id = r.id;
  end if;
  update public.revision_requests set task_id = v_task where id = r.id;

  if v_assignee is not null then
    perform private.notify(r.workspace_id, v_assignee, 'adjustment_requested', 'approvals', 'Ajuste solicitado',
      d.title || ': ' || left(r.reason, 140), '/app/tarefas/' || v_task, 'task', v_task, 'adjustment:' || r.id);
  end if;
  perform private.notify_managers(r.workspace_id, c.client_id, 'content_rejected', 'approvals',
    case r.source when 'client' then 'Cliente solicitou ajuste' else 'Aprovação invalidada' end,
    d.title || ' · ' || private.content_label(c.id) || ': ' || left(r.reason, 140),
    '/app/conteudos/' || c.id, 'content', c.id, 'rejected:' || r.id);
  return v_task;
end $$;

-- Manager explicitly invalidates an approval (e.g. a video change affects the cover).
create or replace function public.invalidate_approval(p_deliverable uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.deliverables%rowtype; c public.content_items%rowtype; v_rev uuid;
begin
  select * into d from public.deliverables where id = p_deliverable for update;
  if not found or not private.can_access_deliverable(p_deliverable) then perform private.fail('not_found', 'deliverable'); end if;
  perform private.require_perm(d.workspace_id, 'approvals.invalidate');
  if char_length(coalesce(btrim(p_reason), '')) < 3 then perform private.fail('comment_required'); end if;
  if d.approval_status <> 'approved' then perform private.fail('invalid_transition', 'deliverable not approved'); end if;
  select * into c from public.content_items where id = d.content_id;

  perform private.allow_state_change();
  update public.deliverable_versions set status = 'rejected', decided_at = now() where id = d.current_version_id;
  update public.deliverables set approval_status = 'rejected' where id = d.id;
  insert into public.revision_requests (workspace_id, content_id, deliverable_id, version_id, source, reason, requested_by)
  values (d.workspace_id, c.id, d.id, d.current_version_id, 'internal', btrim(p_reason), auth.uid())
  on conflict (version_id) where status = 'open' do nothing
  returning id into v_rev;
  if v_rev is not null then perform private.create_adjustment_task(v_rev); end if;
  perform private.audit(d.workspace_id, 'approval.invalidated', 'deliverable', d.id, jsonb_build_object('reason', p_reason));
  perform private.log_activity(d.workspace_id, 'deliverable', d.id, 'approval.invalidated', c.client_id, c.id,
                               jsonb_build_object('reason', p_reason));
  perform private.recompute_content(c.id);
  return v_rev;
end $$;

-- -----------------------------------------------------------------------------
-- Approval batches & links (agency side)
-- -----------------------------------------------------------------------------
create or replace function public.create_approval_batch(
  p_ws uuid, p_client uuid, p_name text, p_content_ids uuid[],
  p_due_at timestamptz default null, p_expires_at timestamptz default null, p_pin text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cl public.clients%rowtype; s public.workspace_settings%rowtype;
  v_batch uuid; v_link uuid; v_token text; v_expires timestamptz; v_not_ready text; v_count integer;
begin
  perform private.require_perm(p_ws, 'approvals.manage');
  if not private.can_access_client(p_ws, p_client) then perform private.fail('permission_denied', 'client'); end if;
  select * into cl from public.clients where id = p_client and workspace_id = p_ws;
  if not found then perform private.fail('not_found', 'client'); end if;
  select * into s from public.workspace_settings where workspace_id = p_ws;
  if coalesce(array_length(p_content_ids, 1), 0) = 0 then perform private.fail('validation', 'contents'); end if;

  select count(*) into v_count from public.content_items
   where id = any(p_content_ids) and client_id = p_client and workspace_id = p_ws and archived_at is null;
  if v_count <> array_length(p_content_ids, 1) then perform private.fail('validation', 'contents_must_belong_to_client'); end if;

  -- Every client-facing required deliverable must have a reviewed (released) version.
  select string_agg('#' || c.code, ', ') into v_not_ready
    from public.content_items c
   where c.id = any(p_content_ids) and exists (
     select 1 from public.deliverables d
      left join public.deliverable_versions v on v.id = d.current_version_id
      where d.content_id = c.id and d.required and d.client_facing and (v.id is null or v.released_at is null));
  if v_not_ready is not null then perform private.fail('invalid_transition', 'not_reviewed ' || v_not_ready); end if;

  if p_pin is not null and p_pin !~ '^[0-9]{4,8}$' then perform private.fail('validation', 'pin'); end if;
  v_expires := coalesce(p_expires_at, now() + make_interval(days => coalesce(s.approval_default_expiry_days, 15)));
  if v_expires <= now() then perform private.fail('validation', 'expires_at'); end if;
  if (cl.is_sensitive or coalesce(s.approval_require_pin, false)) and p_pin is null then
    perform private.fail('validation', 'pin_required');
  end if;
  if cl.is_sensitive and v_expires > now() + interval '30 days' then
    perform private.fail('validation', 'sensitive_expiry_max_30_days');
  end if;

  insert into public.approval_batches (workspace_id, client_id, name, due_at, created_by)
  values (p_ws, p_client, btrim(p_name), p_due_at, auth.uid()) returning id into v_batch;
  insert into public.approval_batch_items (workspace_id, batch_id, content_id, position)
  select p_ws, v_batch, x.id, (x.ord - 1)::smallint from unnest(p_content_ids) with ordinality as x(id, ord);

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.approval_links (workspace_id, batch_id, token_hash, token_hint, pin_hash, expires_at, created_by)
  values (p_ws, v_batch, extensions.digest(v_token, 'sha256'), right(v_token, 4),
          case when p_pin is not null then extensions.crypt(p_pin, extensions.gen_salt('bf', 8)) end,
          v_expires, auth.uid())
  returning id into v_link;

  perform private.recompute_content(x) from unnest(p_content_ids) as x;
  perform private.log_activity(p_ws, 'approval_batch', v_batch, 'approval.batch_created', p_client, null,
                               jsonb_build_object('name', p_name, 'contents', array_length(p_content_ids, 1)));
  perform private.audit(p_ws, 'approval.link_created', 'approval_link', v_link,
                        jsonb_build_object('batch', v_batch, 'expires_at', v_expires, 'pin', p_pin is not null));
  return jsonb_build_object('batch_id', v_batch, 'link_id', v_link, 'token', v_token, 'expires_at', v_expires);
end $$;

create or replace function public.revoke_approval_link(p_link uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.approval_links%rowtype;
begin
  select * into l from public.approval_links where id = p_link for update;
  if not found then perform private.fail('not_found', 'link'); end if;
  perform private.require_perm(l.workspace_id, 'approvals.manage');
  if l.revoked_at is not null then return; end if;
  update public.approval_links set revoked_at = now(), revoked_by = auth.uid() where id = p_link;
  delete from public.approval_link_sessions where link_id = p_link;
  perform private.audit(l.workspace_id, 'approval.link_revoked', 'approval_link', p_link);
end $$;

-- New token for an existing batch (old link revoked).
create or replace function public.rotate_approval_link(p_batch uuid, p_expires_at timestamptz default null, p_pin text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.approval_batches%rowtype; cl public.clients%rowtype; v_token text; v_link uuid; v_expires timestamptz;
begin
  select * into b from public.approval_batches where id = p_batch;
  if not found then perform private.fail('not_found', 'batch'); end if;
  perform private.require_perm(b.workspace_id, 'approvals.manage');
  select * into cl from public.clients where id = b.client_id;
  if p_pin is not null and p_pin !~ '^[0-9]{4,8}$' then perform private.fail('validation', 'pin'); end if;
  if cl.is_sensitive and p_pin is null then perform private.fail('validation', 'pin_required'); end if;
  v_expires := coalesce(p_expires_at, now() + interval '15 days');
  if cl.is_sensitive and v_expires > now() + interval '30 days' then perform private.fail('validation', 'sensitive_expiry_max_30_days'); end if;
  perform public.revoke_approval_link(l.id) from public.approval_links l where l.batch_id = p_batch and l.revoked_at is null;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.approval_links (workspace_id, batch_id, token_hash, token_hint, pin_hash, expires_at, created_by)
  values (b.workspace_id, p_batch, extensions.digest(v_token, 'sha256'), right(v_token, 4),
          case when p_pin is not null then extensions.crypt(p_pin, extensions.gen_salt('bf', 8)) end, v_expires, auth.uid())
  returning id into v_link;
  perform private.audit(b.workspace_id, 'approval.link_rotated', 'approval_link', v_link);
  return jsonb_build_object('batch_id', p_batch, 'link_id', v_link, 'token', v_token, 'expires_at', v_expires);
end $$;

-- -----------------------------------------------------------------------------
-- Client portal (anonymous; token + session validated in the database)
-- -----------------------------------------------------------------------------
create or replace function private.portal_link(p_token text)
returns public.approval_links language plpgsql security definer set search_path = '' as $$
declare l public.approval_links%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then perform private.fail('link_unavailable'); end if;
  select * into l from public.approval_links where token_hash = extensions.digest(p_token, 'sha256');
  if not found or l.revoked_at is not null or (l.expires_at is not null and l.expires_at <= now()) then
    perform private.fail('link_unavailable');
  end if;
  return l;
end $$;

create or replace function private.portal_session(p_token text, p_session text)
returns public.approval_links language plpgsql security definer set search_path = '' as $$
declare l public.approval_links%rowtype;
begin
  l := private.portal_link(p_token);
  if p_session is null or p_session !~ '^[0-9a-f]{64}$' or not exists (
       select 1 from public.approval_link_sessions s
        where s.link_id = l.id and s.session_hash = extensions.digest(p_session, 'sha256') and s.expires_at > now()) then
    perform private.fail('session_invalid');
  end if;
  return l;
end $$;

-- Opens the link. Wrong PINs are counted (not raised) so the counter persists.
create or replace function public.portal_open(p_token text, p_pin text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.approval_links%rowtype; v_session text; v_attempts integer;
begin
  l := private.portal_link(p_token);
  select * into l from public.approval_links where id = l.id for update;
  if l.locked_until is not null and l.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', l.locked_until);
  end if;
  if l.pin_hash is not null then
    if p_pin is null then
      return jsonb_build_object('ok', false, 'error', 'pin_required');
    end if;
    if extensions.crypt(p_pin, l.pin_hash) <> l.pin_hash then
      v_attempts := l.failed_attempts + 1;
      if v_attempts >= 5 then
        update public.approval_links set failed_attempts = 0, locked_until = now() + interval '15 minutes' where id = l.id;
        insert into public.audit_logs (workspace_id, action, entity_type, entity_id, data)
        values (l.workspace_id, 'approval.link_locked', 'approval_link', l.id, '{}'::jsonb);
        return jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', now() + interval '15 minutes');
      end if;
      update public.approval_links set failed_attempts = v_attempts where id = l.id;
      return jsonb_build_object('ok', false, 'error', 'pin_invalid', 'attempts_left', 5 - v_attempts);
    end if;
  end if;
  update public.approval_links set failed_attempts = 0, locked_until = null, last_accessed_at = now() where id = l.id;
  delete from public.approval_link_sessions where link_id = l.id and expires_at <= now();
  v_session := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.approval_link_sessions (link_id, session_hash, expires_at)
  values (l.id, extensions.digest(v_session, 'sha256'), least(now() + interval '12 hours', coalesce(l.expires_at, 'infinity')));
  return jsonb_build_object('ok', true, 'session', v_session);
end $$;

create or replace function public.portal_get(p_token text, p_session text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.approval_links%rowtype; v_result jsonb;
begin
  l := private.portal_session(p_token, p_session);
  update public.approval_links set last_accessed_at = now() where id = l.id;

  select jsonb_build_object(
    'agency', jsonb_build_object('name', w.name, 'logo_path', w.logo_path, 'brand_color', w.brand_color),
    'client', jsonb_build_object('name', cl.name, 'logo_path', cl.logo_path),
    'batch',  jsonb_build_object('id', b.id, 'name', b.name, 'due_at', b.due_at, 'status', b.status,
                                 'submitted_at', b.submitted_at, 'expires_at', l.expires_at),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'content_id', c.id, 'code', c.code, 'title', c.title, 'objective', c.objective,
        'format', f.name, 'format_key', f.key, 'aspect_ratio', f.aspect_ratio,
        'service', s.name, 'planned_publish_at', c.planned_publish_at, 'channel', c.channel,
        'deliverables', coalesce((
          select jsonb_agg(jsonb_build_object(
            'deliverable_id', d.id, 'kind', d.kind, 'title', d.title,
            'version', case when rv.id is null then null else jsonb_build_object(
               'id', rv.id, 'number', rv.version_number, 'text', rv.text_content, 'external_url', rv.external_url,
               'status', rv.status, 'created_at', rv.created_at,
               'decidable', rv.id = d.current_version_id,
               'assets', coalesce((
                 select jsonb_agg(jsonb_build_object(
                   'id', a.id, 'name', a.name, 'mime_type', a.mime_type, 'provider', a.provider,
                   'bucket', a.storage_bucket, 'path', a.storage_path, 'preview_path', a.preview_path,
                   'thumbnail_path', a.thumbnail_path, 'width', a.width, 'height', a.height,
                   'drive_file_id', a.drive_file_id, 'status', a.status) order by dva.position)
                 from public.deliverable_version_assets dva join public.file_assets a on a.id = dva.asset_id
                 where dva.version_id = rv.id), '[]'::jsonb)) end,
            'decision', (select jsonb_build_object('decision', r.decision, 'comment', r.comment, 'at', r.created_at,
                                                   'reviewer_name', r.reviewer_name)
                           from public.approval_responses r where r.version_id = rv.id
                          order by r.created_at desc limit 1),
            'history', coalesce((
              select jsonb_agg(jsonb_build_object('version', pv.version_number, 'decision', pr.decision,
                                                  'comment', pr.comment, 'at', pr.created_at) order by pv.version_number)
                from public.deliverable_versions pv
                join lateral (select * from public.approval_responses r2 where r2.version_id = pv.id
                              order by r2.created_at desc limit 1) pr on true
               where pv.deliverable_id = d.id and pv.id <> rv.id), '[]'::jsonb)
          ) order by d.position)
          from public.deliverables d
          left join lateral (select v.* from public.deliverable_versions v
                              where v.deliverable_id = d.id and v.released_at is not null
                              order by v.version_number desc limit 1) rv on true
          where d.content_id = c.id and d.client_facing), '[]'::jsonb)
      ) order by i.position)
      from public.approval_batch_items i
      join public.content_items c on c.id = i.content_id
      join public.content_formats f on f.id = c.format_id
      left join public.client_services s on s.id = c.service_id
      where i.batch_id = b.id and c.archived_at is null), '[]'::jsonb)
  ) into v_result
  from public.approval_batches b
  join public.workspaces w on w.id = b.workspace_id
  join public.clients cl on cl.id = b.client_id
  where b.id = l.batch_id;
  return v_result;
end $$;

-- Core decision logic shared by single and bulk actions.
-- Returns: applied | unchanged | duplicate | override_required | skipped_rejected
create or replace function private.portal_apply(
  l public.approval_links, p_version uuid, p_decision text, p_comment text,
  p_reviewer text, p_key text, p_override boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v public.deliverable_versions%rowtype; d public.deliverables%rowtype; c public.content_items%rowtype;
  b public.approval_batches%rowtype; v_rev uuid; v_resp uuid; v_open_rev public.revision_requests%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then perform private.fail('validation', 'decision'); end if;
  select * into v from public.deliverable_versions where id = p_version;
  if not found then perform private.fail('not_found', 'version'); end if;
  select * into d from public.deliverables where id = v.deliverable_id for update;   -- serialize decisions
  select * into c from public.content_items where id = d.content_id;
  select * into b from public.approval_batches where id = l.batch_id;

  if b.status = 'closed' then perform private.fail('invalid_transition', 'batch_closed'); end if;
  if not exists (select 1 from public.approval_batch_items i where i.batch_id = l.batch_id and i.content_id = c.id)
     or not d.client_facing then
    perform private.fail('not_found', 'version');
  end if;

  if exists (select 1 from public.approval_responses where link_id = l.id and idempotency_key = p_key) then
    return 'duplicate';
  end if;

  -- The decision must target the exact version currently under review.
  if v.released_at is null or d.current_version_id is distinct from v.id or v.status = 'superseded' then
    perform private.fail('stale_version');
  end if;
  if c.publication_status = 'published' then perform private.fail('invalid_transition', 'content_published'); end if;

  p_comment := nullif(btrim(coalesce(p_comment, '')), '');
  if p_decision = 'rejected' and (p_comment is null or char_length(p_comment) < 3) then
    perform private.fail('comment_required');
  end if;

  if v.status::text = p_decision then return 'unchanged'; end if;
  if v.status = 'rejected' and p_decision = 'approved' then
    if not coalesce(p_override, false) then return 'override_required'; end if;
    select * into v_open_rev from public.revision_requests where version_id = v.id and status = 'open' for update;
    if found then
      perform private.allow_state_change();
      update public.revision_requests set status = 'cancelled', resolved_at = now() where id = v_open_rev.id;
      update public.tasks set status = 'cancelled' where id = v_open_rev.task_id and status not in ('done', 'cancelled');
    end if;
  end if;

  perform private.allow_state_change();

  -- Revision first, so the (append-only) response is written already linked.
  if p_decision = 'rejected' then
    insert into public.revision_requests (workspace_id, content_id, deliverable_id, version_id, source, reason)
    values (l.workspace_id, c.id, d.id, v.id, 'client', p_comment)
    on conflict (version_id) where status = 'open' do nothing
    returning id into v_rev;
  end if;

  insert into public.approval_responses (workspace_id, link_id, batch_id, content_id, deliverable_id, version_id,
                                         decision, comment, reviewer_name, idempotency_key, revision_request_id)
  values (l.workspace_id, l.id, l.batch_id, c.id, d.id, v.id, p_decision, p_comment,
          nullif(btrim(coalesce(p_reviewer, '')), ''), p_key, v_rev)
  on conflict (link_id, idempotency_key) do nothing
  returning id into v_resp;
  if v_resp is null then
    -- Lost a race on the same idempotency key: undo everything in this call.
    perform private.fail('duplicate');
  end if;

  update public.deliverable_versions set status = p_decision::public.version_status, decided_at = now() where id = v.id;
  update public.deliverables set approval_status = p_decision::public.version_status where id = d.id;
  if v_rev is not null then perform private.create_adjustment_task(v_rev); end if;

  perform private.log_activity(l.workspace_id, 'deliverable', d.id,
    case p_decision when 'approved' then 'approval.approved' else 'approval.rejected' end,
    c.client_id, c.id, jsonb_build_object('version', v.version_number, 'comment', p_comment, 'kind', d.kind),
    'client', coalesce(nullif(btrim(coalesce(p_reviewer, '')), ''), 'Cliente'));
  perform private.recompute_content(c.id);
  return 'applied';
end $$;

create or replace function public.portal_respond(
  p_token text, p_session text, p_version uuid, p_decision text, p_comment text,
  p_reviewer_name text, p_idempotency_key text, p_confirm_override boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.approval_links%rowtype; v_status text;
begin
  l := private.portal_session(p_token, p_session);
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 120 then
    perform private.fail('validation', 'idempotency_key');
  end if;
  v_status := private.portal_apply(l, p_version, p_decision, p_comment, p_reviewer_name, p_idempotency_key, p_confirm_override);
  return jsonb_build_object('status', v_status);
end $$;

-- Approves every pending deliverable (optionally of one content). Rejected
-- items are skipped unless p_include_rejected (explicit confirmation).
create or replace function public.portal_bulk_approve(
  p_token text, p_session text, p_content uuid, p_reviewer_name text,
  p_idempotency_key text, p_include_rejected boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l public.approval_links%rowtype; r record; v_status text;
  v_applied integer := 0; v_skipped_rejected integer := 0; v_unchanged integer := 0;
begin
  l := private.portal_session(p_token, p_session);
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    perform private.fail('validation', 'idempotency_key');
  end if;
  for r in
    select v.id as version_id, v.status
      from public.approval_batch_items i
      join public.deliverables d on d.content_id = i.content_id and d.client_facing
      join public.deliverable_versions v on v.id = d.current_version_id and v.released_at is not null
     where i.batch_id = l.batch_id and (p_content is null or i.content_id = p_content)
     order by i.position, d.position
  loop
    if r.status = 'approved' then v_unchanged := v_unchanged + 1; continue; end if;
    if r.status = 'rejected' and not p_include_rejected then v_skipped_rejected := v_skipped_rejected + 1; continue; end if;
    v_status := private.portal_apply(l, r.version_id, 'approved', null, p_reviewer_name,
                                     p_idempotency_key || ':' || r.version_id, p_include_rejected);
    if v_status = 'applied' then v_applied := v_applied + 1;
    elsif v_status = 'override_required' then v_skipped_rejected := v_skipped_rejected + 1;
    else v_unchanged := v_unchanged + 1; end if;
  end loop;
  return jsonb_build_object('approved', v_applied, 'skipped_rejected', v_skipped_rejected, 'unchanged', v_unchanged);
end $$;

create or replace function public.portal_finalize(p_token text, p_session text, p_reviewer_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.approval_links%rowtype; b public.approval_batches%rowtype; v_summary jsonb; v_responses integer;
begin
  l := private.portal_session(p_token, p_session);
  select * into b from public.approval_batches where id = l.batch_id for update;

  select jsonb_build_object(
    'approved_contents',   count(*) filter (where c.approval_status = 'approved'),
    'adjustment_contents', count(*) filter (where c.approval_status = 'rejected'
                                            or exists (select 1 from public.deliverables d where d.content_id = c.id
                                                       and d.client_facing and d.approval_status = 'rejected')),
    'pending_items', (select count(*) from public.approval_batch_items i2
                       join public.deliverables d on d.content_id = i2.content_id and d.client_facing
                       join public.deliverable_versions v on v.id = d.current_version_id and v.released_at is not null
                      where i2.batch_id = b.id and v.status = 'pending'),
    'total_contents', count(*))
  into v_summary
  from public.approval_batch_items i join public.content_items c on c.id = i.content_id
  where i.batch_id = b.id;

  select count(*) into v_responses from public.approval_responses where batch_id = b.id;
  update public.approval_batches set status = 'submitted', submitted_at = now() where id = b.id;
  perform private.notify_managers(b.workspace_id, b.client_id, 'batch_submitted', 'approvals',
    'Cliente finalizou a avaliação', b.name || ': ' || (v_summary ->> 'approved_contents') || ' aprovado(s), '
      || (v_summary ->> 'adjustment_contents') || ' com ajuste(s)',
    '/app/aprovacoes/' || b.id, 'approval_batch', b.id, 'batch_submitted:' || b.id || ':' || v_responses);
  perform private.log_activity(b.workspace_id, 'approval_batch', b.id, 'approval.batch_submitted', b.client_id, null,
                               v_summary, 'client', coalesce(p_reviewer_name, 'Cliente'));
  return v_summary || jsonb_build_object('received_at', now());
end $$;

-- -----------------------------------------------------------------------------
-- Editorial / publication
-- -----------------------------------------------------------------------------
create or replace function private.lock_content_for_publication(p_content uuid)
returns public.content_items language plpgsql security definer set search_path = '' as $$
declare c public.content_items%rowtype;
begin
  select * into c from public.content_items where id = p_content for update;
  if not found or not private.can_access_content(p_content) then perform private.fail('not_found', 'content'); end if;
  perform private.require_perm(c.workspace_id, 'publications.manage');
  return c;
end $$;

create or replace function public.schedule_publication(
  p_content uuid, p_scheduled_at timestamptz, p_channel text default null, p_override_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.content_items%rowtype; v_override boolean := false;
begin
  c := private.lock_content_for_publication(p_content);
  if c.publication_status in ('published', 'cancelled') then perform private.fail('invalid_transition', c.publication_status::text); end if;
  if p_scheduled_at is null then perform private.fail('validation', 'scheduled_at'); end if;
  if c.approval_status <> 'approved' or c.production_status <> 'done' then
    if char_length(coalesce(btrim(p_override_reason), '')) < 3 then perform private.fail('approval_required'); end if;
    perform private.require_perm(c.workspace_id, 'publications.override');
    v_override := true;
  end if;
  perform private.allow_state_change();
  update public.content_items
     set publication_status = 'scheduled', scheduled_at = p_scheduled_at, scheduled_by = auth.uid(),
         planned_publish_at = p_scheduled_at, channel = coalesce(nullif(p_channel, ''), channel),
         publish_override_reason = case when v_override then btrim(p_override_reason) else null end
   where id = p_content;
  if v_override then
    perform private.audit(c.workspace_id, 'publication.override', 'content', c.id, jsonb_build_object('reason', p_override_reason));
  end if;
  perform private.log_activity(c.workspace_id, 'content', c.id, 'publication.scheduled', c.client_id, c.id,
    jsonb_build_object('scheduled_at', p_scheduled_at, 'override', v_override));
  perform private.recompute_content(c.id);
end $$;

-- Drag & drop in the calendar. Scheduled contents are re-scheduled (logged).
create or replace function public.move_publication(p_content uuid, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.content_items%rowtype;
begin
  select * into c from public.content_items where id = p_content for update;
  if not found or not private.can_access_content(p_content) then perform private.fail('not_found', 'content'); end if;
  if not (private.has_perm(c.workspace_id, 'publications.manage') or private.has_perm(c.workspace_id, 'contents.manage')) then
    perform private.fail('permission_denied', 'publications.manage');
  end if;
  if c.publication_status in ('published', 'cancelled') then perform private.fail('invalid_transition', c.publication_status::text); end if;
  perform private.allow_state_change();
  if c.publication_status = 'scheduled' then
    perform private.require_perm(c.workspace_id, 'publications.manage');
    update public.content_items set scheduled_at = p_at, planned_publish_at = p_at where id = p_content;
    perform private.log_activity(c.workspace_id, 'content', c.id, 'publication.rescheduled', c.client_id, c.id,
      jsonb_build_object('from', c.scheduled_at, 'to', p_at));
  else
    update public.content_items set planned_publish_at = p_at where id = p_content;
    perform private.log_activity(c.workspace_id, 'content', c.id, 'publication.planned', c.client_id, c.id,
      jsonb_build_object('from', c.planned_publish_at, 'to', p_at));
  end if;
  perform private.recompute_content(c.id);
end $$;

create or replace function public.unschedule_publication(p_content uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.content_items%rowtype;
begin
  c := private.lock_content_for_publication(p_content);
  if c.publication_status <> 'scheduled' then return; end if;
  perform private.allow_state_change();
  update public.content_items set publication_status = 'planned', scheduled_at = null, scheduled_by = null,
                                  publish_override_reason = null
   where id = p_content;
  perform private.log_activity(c.workspace_id, 'content', c.id, 'publication.unscheduled', c.client_id, c.id);
  perform private.recompute_content(c.id);
end $$;

create or replace function public.confirm_publication(p_content uuid, p_published_at timestamptz, p_url text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.content_items%rowtype;
begin
  c := private.lock_content_for_publication(p_content);
  if c.publication_status = 'published' then return; end if;
  if c.publication_status not in ('scheduled', 'ready') then perform private.fail('invalid_transition', c.publication_status::text); end if;
  if p_published_at is null or p_published_at > now() + interval '5 minutes' then perform private.fail('validation', 'published_at'); end if;
  if p_url is not null and btrim(p_url) <> '' and p_url !~* '^https://' then perform private.fail('validation', 'url'); end if;
  perform private.allow_state_change();
  update public.content_items
     set publication_status = 'published', published_at = p_published_at, published_by = auth.uid(),
         published_url = nullif(btrim(coalesce(p_url, '')), '')
   where id = p_content;
  perform private.log_activity(c.workspace_id, 'content', c.id, 'publication.confirmed', c.client_id, c.id,
    jsonb_build_object('published_at', p_published_at, 'url', p_url));
  perform private.recompute_content(c.id);
end $$;

create or replace function public.cancel_content(p_content uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.content_items%rowtype;
begin
  select * into c from public.content_items where id = p_content for update;
  if not found or not private.can_access_content(p_content) then perform private.fail('not_found', 'content'); end if;
  perform private.require_perm(c.workspace_id, 'contents.manage');
  if c.publication_status = 'published' then perform private.fail('invalid_transition', 'published'); end if;
  perform private.allow_state_change();
  update public.content_items set publication_status = 'cancelled' where id = p_content;
  update public.tasks set status = 'cancelled' where content_id = p_content and status not in ('done', 'cancelled');
  perform private.log_activity(c.workspace_id, 'content', c.id, 'content.cancelled', c.client_id, c.id,
                               jsonb_build_object('reason', p_reason));
  perform private.recompute_content(c.id);
end $$;

-- -----------------------------------------------------------------------------
-- Scheduled scan (deadlines). Called by cron with the service role.
-- -----------------------------------------------------------------------------
create or replace function public.run_deadline_scan()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_n integer := 0;
begin
  -- Due within 24h
  for r in select * from public.tasks where status in ('pending', 'in_progress', 'reopened')
            and due_at between now() and now() + interval '24 hours' and assignee_id is not null loop
    perform private.notify(r.workspace_id, r.assignee_id, 'task_due_soon', 'tasks', 'Prazo próximo', r.title,
      '/app/tarefas/' || r.id, 'task', r.id, 'task_due_soon:' || r.id || ':' || r.due_at::date);
    v_n := v_n + 1;
  end loop;
  -- Overdue (one notification per task per day)
  for r in select * from public.tasks where status not in ('done', 'cancelled', 'blocked') and due_at < now() loop
    perform private.notify(r.workspace_id, r.assignee_id, 'task_overdue', 'tasks', 'Tarefa atrasada', r.title,
      '/app/tarefas/' || r.id, 'task', r.id, 'task_overdue:' || r.id || ':' || current_date);
    v_n := v_n + 1;
  end loop;
  -- Publication within 48h without approval
  for r in select * from public.content_items where archived_at is null
            and publication_status in ('planned', 'unscheduled') and approval_status <> 'approved'
            and planned_publish_at between now() and now() + interval '48 hours' loop
    perform private.notify_managers(r.workspace_id, r.client_id, 'publication_soon_unapproved', 'publications',
      'Publicação próxima sem aprovação', '#' || r.code || ' ' || r.title, '/app/conteudos/' || r.id,
      'content', r.id, 'pub_soon:' || r.id || ':' || r.planned_publish_at::date);
    v_n := v_n + 1;
  end loop;
  -- Late publication (date passed without confirmation)
  for r in select * from public.content_items where archived_at is null
            and publication_status not in ('published', 'cancelled')
            and coalesce(scheduled_at, planned_publish_at) < now() loop
    perform private.notify_managers(r.workspace_id, r.client_id, 'publication_late', 'publications',
      case when r.publication_status = 'scheduled' then 'Publicação aguardando confirmação' else 'Publicação atrasada' end,
      '#' || r.code || ' ' || r.title, '/app/conteudos/' || r.id, 'content', r.id,
      'pub_late:' || r.id || ':' || current_date);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('signals', v_n);
end $$;
