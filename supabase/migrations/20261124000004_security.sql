-- =============================================================================
-- Delta Flow — 0004 Security: authorization helpers, RLS, state guards, grants
--
-- Model
--   * is_member(ws)            : active membership in the workspace
--   * has_perm(ws, perm)       : any of the member's roles grants perm
--                                (role 'owner' implicitly grants everything)
--   * can_access_client(ws, c) : member AND (clients.view_all OR allocated)
--   * can_access_content(id)   : can_access_client OR assigned to the content
--                                (content_assignees or any task assignee)
--
-- State columns (statuses, versions, publication confirmation) can only be
-- changed by the business RPCs in 0005, which set `app.state_change = on`
-- for the duration of the transaction. Direct UPDATEs are rejected even for
-- users with edit permission. UI hiding is NOT the security boundary.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER: they read membership tables without
-- recursing into RLS; they only ever answer about auth.uid()).
-- -----------------------------------------------------------------------------
create or replace function private.is_member(p_ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_ws and m.user_id = (select auth.uid()) and m.status = 'active'
  )
$$;

create or replace function private.has_perm(p_ws uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.workspace_members m
    join public.member_roles mr on mr.member_id = m.id
    join public.roles r on r.id = mr.role_id
    where m.workspace_id = p_ws
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (r.key = 'owner' or exists (
            select 1 from public.role_permissions rp
            where rp.role_id = r.id and rp.permission_key = p_perm))
  )
$$;

create or replace function private.can_access_client(p_ws uuid, p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_member(p_ws) and (
    private.has_perm(p_ws, 'clients.view_all')
    or exists (
      select 1 from public.client_members cm
      where cm.client_id = p_client and cm.workspace_id = p_ws and cm.user_id = (select auth.uid())
    )
  )
$$;

create or replace function private.is_content_assignee(p_content uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.content_assignees a where a.content_id = p_content and a.user_id = (select auth.uid()))
      or exists (select 1 from public.tasks t where t.content_id = p_content and t.assignee_id = (select auth.uid())
                   and t.status <> 'cancelled')
$$;

create or replace function private.can_access_content(p_content uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.content_items c
    where c.id = p_content
      and private.is_member(c.workspace_id)
      and (private.can_access_client(c.workspace_id, c.client_id) or private.is_content_assignee(c.id))
  )
$$;

create or replace function private.can_access_deliverable(p_deliverable uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.deliverables d
    where d.id = p_deliverable and private.can_access_content(d.content_id)
  )
$$;

create or replace function private.can_access_version(p_version uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.deliverable_versions v
    where v.id = p_version and private.can_access_deliverable(v.deliverable_id)
  )
$$;

create or replace function private.shares_workspace(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.workspace_members me
    join public.workspace_members other on other.workspace_id = me.workspace_id
    where me.user_id = (select auth.uid()) and me.status = 'active'
      and other.user_id = p_user and other.status in ('active', 'disabled')
  )
$$;

-- Raise a standard permission error (SQLSTATE 42501 => mapped to 403 in app).
create or replace function private.require_perm(p_ws uuid, p_perm text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_perm(p_ws, p_perm) then
    raise exception 'permission_denied: %', p_perm using errcode = '42501';
  end if;
end $$;

create or replace function private.require_member(p_ws uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_member(p_ws) then
    raise exception 'permission_denied: not a member' using errcode = '42501';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- State guards
-- -----------------------------------------------------------------------------
create or replace function private.state_change_allowed()
returns boolean language sql stable as $$
  select coalesce(current_setting('app.state_change', true), '') = 'on'
$$;

create or replace function private.guard_content_state()
returns trigger language plpgsql as $$
begin
  if not private.state_change_allowed() and (
       new.production_status  is distinct from old.production_status
    or new.approval_status    is distinct from old.approval_status
    or new.publication_status is distinct from old.publication_status
    or new.stage              is distinct from old.stage
    or new.scheduled_at       is distinct from old.scheduled_at
    or new.scheduled_by       is distinct from old.scheduled_by
    or new.published_at       is distinct from old.published_at
    or new.published_by       is distinct from old.published_by
    or new.publish_override_reason is distinct from old.publish_override_reason
    or new.code               is distinct from old.code
    or new.workspace_id       is distinct from old.workspace_id
    or new.client_id          is distinct from old.client_id
    or new.format_id          is distinct from old.format_id
  ) then
    raise exception 'invalid_transition: status fields can only change through workflow actions'
      using errcode = 'P0001';
  end if;

  -- Editorial date is a free edit; derived publication status follows it.
  if new.planned_publish_at is distinct from old.planned_publish_at then
    if new.planned_publish_at is not null and new.publication_status = 'unscheduled' then
      new.publication_status := 'planned';
    elsif new.planned_publish_at is null and new.publication_status = 'planned' then
      new.publication_status := 'unscheduled';
    end if;
  end if;

  new.lock_version := old.lock_version + 1;
  return new;
end $$;
create trigger content_items_guard before update on public.content_items
  for each row execute function private.guard_content_state();

create or replace function private.guard_task_state()
returns trigger language plpgsql as $$
begin
  if not private.state_change_allowed() and (
       new.status              is distinct from old.status
    or new.completed_at        is distinct from old.completed_at
    or new.completed_by        is distinct from old.completed_by
    or new.started_at          is distinct from old.started_at
    or new.revision_request_id is distinct from old.revision_request_id
    or new.kind                is distinct from old.kind
    or new.deliverable_id      is distinct from old.deliverable_id
    or new.content_id          is distinct from old.content_id
    or new.client_id           is distinct from old.client_id
    or new.workspace_id        is distinct from old.workspace_id
    or new.step_key            is distinct from old.step_key
    or new.reopen_count        is distinct from old.reopen_count
  ) then
    raise exception 'invalid_transition: task status can only change through workflow actions'
      using errcode = 'P0001';
  end if;
  -- Only managers reassign; the assignee cannot hand work to someone else.
  if not private.state_change_allowed()
     and new.assignee_id is distinct from old.assignee_id
     and not private.has_perm(new.workspace_id, 'tasks.manage') then
    raise exception 'permission_denied: tasks.manage' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger tasks_guard before update on public.tasks
  for each row execute function private.guard_task_state();

create or replace function private.guard_task_insert()
returns trigger language plpgsql as $$
begin
  if not private.state_change_allowed() then
    -- Manually created tasks are always plain general tasks starting pending.
    if new.kind <> 'general' or new.status not in ('pending') or new.revision_request_id is not null
       or new.completed_at is not null then
      raise exception 'invalid_transition: manual tasks must be general and pending' using errcode = 'P0001';
    end if;
    if new.content_id is not null and not exists (
      select 1 from public.content_items c where c.id = new.content_id and c.client_id = new.client_id
    ) then
      raise exception 'invalid_reference: content does not belong to client' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger tasks_guard_insert before insert on public.tasks
  for each row execute function private.guard_task_insert();

create or replace function private.guard_deliverable_state()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and not private.state_change_allowed() and (
       new.current_version_id is distinct from old.current_version_id
    or new.approval_status    is distinct from old.approval_status
    or new.content_id         is distinct from old.content_id
    or new.kind               is distinct from old.kind
  ) then
    raise exception 'invalid_transition: deliverable state can only change through workflow actions'
      using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and not private.state_change_allowed()
     and (new.current_version_id is not null or new.approval_status <> 'pending') then
    raise exception 'invalid_transition: new deliverables start without versions' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger deliverables_guard before insert or update on public.deliverables
  for each row execute function private.guard_deliverable_state();

-- Versions are immutable records. Only workflow status fields may move.
create or replace function private.guard_version_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'immutable: versions cannot be deleted' using errcode = 'P0001';
  end if;
  if new.text_content   is distinct from old.text_content
  or new.external_url   is distinct from old.external_url
  or new.version_number is distinct from old.version_number
  or new.deliverable_id is distinct from old.deliverable_id
  or new.author_id      is distinct from old.author_id
  or new.created_at     is distinct from old.created_at then
    raise exception 'immutable: version content cannot change, create a new version' using errcode = 'P0001';
  end if;
  if not private.state_change_allowed() then
    raise exception 'invalid_transition: version status changes through workflow actions' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger deliverable_versions_immutable before update or delete on public.deliverable_versions
  for each row execute function private.guard_version_immutable();

create or replace function private.guard_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'immutable: % is append-only', tg_table_name using errcode = 'P0001';
end $$;
create trigger approval_responses_append_only before update or delete on public.approval_responses
  for each row execute function private.guard_append_only();
create trigger activity_logs_append_only before update or delete on public.activity_logs
  for each row execute function private.guard_append_only();
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function private.guard_append_only();

-- Task dependency cycles are rejected.
create or replace function private.guard_task_dependency()
returns trigger language plpgsql as $$
declare v_cycle boolean;
begin
  with recursive chain(id) as (
    select new.depends_on_task_id
    union
    select d.depends_on_task_id from public.task_dependencies d join chain on d.task_id = chain.id
  )
  select exists (select 1 from chain where id = new.task_id) into v_cycle;
  if v_cycle then
    raise exception 'invalid_dependency: cycle detected' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger task_dependencies_guard before insert on public.task_dependencies
  for each row execute function private.guard_task_dependency();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.workspaces                  enable row level security;
alter table public.workspace_settings          enable row level security;
alter table public.profiles                    enable row level security;
alter table public.workspace_members           enable row level security;
alter table public.permissions                 enable row level security;
alter table public.roles                       enable row level security;
alter table public.role_permissions            enable row level security;
alter table public.member_roles                enable row level security;
alter table public.clients                     enable row level security;
alter table public.client_members              enable row level security;
alter table public.client_services             enable row level security;
alter table public.content_formats             enable row level security;
alter table public.content_templates           enable row level security;
alter table public.monthly_targets             enable row level security;
alter table public.content_items               enable row level security;
alter table public.content_assignees           enable row level security;
alter table public.file_assets                 enable row level security;
alter table public.deliverables                enable row level security;
alter table public.deliverable_versions        enable row level security;
alter table public.deliverable_version_assets  enable row level security;
alter table public.tasks                       enable row level security;
alter table public.task_dependencies           enable row level security;
alter table public.comments                    enable row level security;
alter table public.approval_batches            enable row level security;
alter table public.approval_batch_items        enable row level security;
alter table public.approval_links              enable row level security;
alter table public.approval_link_sessions      enable row level security;
alter table public.approval_responses          enable row level security;
alter table public.revision_requests           enable row level security;
alter table public.notifications               enable row level security;
alter table public.notification_preferences    enable row level security;
alter table public.push_subscriptions          enable row level security;
alter table public.background_jobs             enable row level security;
alter table public.activity_logs               enable row level security;
alter table public.audit_logs                  enable row level security;
alter table public.drive_connections           enable row level security;
alter table public.drive_credentials           enable row level security;
alter table public.drive_folder_mappings       enable row level security;
alter table public.drive_sync_jobs             enable row level security;
alter table private.rate_limits                enable row level security;

-- Workspaces
create policy ws_select on public.workspaces for select to authenticated
  using (private.is_member(id));
create policy ws_update on public.workspaces for update to authenticated
  using (private.has_perm(id, 'workspace.manage')) with check (private.has_perm(id, 'workspace.manage'));

create policy ws_settings_select on public.workspace_settings for select to authenticated
  using (private.is_member(workspace_id));
create policy ws_settings_update on public.workspace_settings for update to authenticated
  using (private.has_perm(workspace_id, 'workspace.manage')) with check (private.has_perm(workspace_id, 'workspace.manage'));

-- Profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_workspace(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Members & roles (writes only through RPCs)
create policy members_select on public.workspace_members for select to authenticated
  using (private.is_member(workspace_id) or user_id = (select auth.uid()));
create policy permissions_select on public.permissions for select to authenticated using (true);
create policy roles_select on public.roles for select to authenticated
  using (private.is_member(workspace_id));
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and private.is_member(r.workspace_id)));
create policy member_roles_select on public.member_roles for select to authenticated
  using (private.is_member(workspace_id));

-- Clients
create policy clients_select on public.clients for select to authenticated
  using (private.can_access_client(workspace_id, id));
create policy clients_insert on public.clients for insert to authenticated
  with check (private.has_perm(workspace_id, 'clients.manage'));
create policy clients_update on public.clients for update to authenticated
  using (private.has_perm(workspace_id, 'clients.manage') and private.can_access_client(workspace_id, id))
  with check (private.has_perm(workspace_id, 'clients.manage'));

create policy client_members_select on public.client_members for select to authenticated
  using (private.can_access_client(workspace_id, client_id));
create policy client_members_insert on public.client_members for insert to authenticated
  with check (private.has_perm(workspace_id, 'clients.manage'));
create policy client_members_delete on public.client_members for delete to authenticated
  using (private.has_perm(workspace_id, 'clients.manage'));

create policy services_select on public.client_services for select to authenticated
  using (private.can_access_client(workspace_id, client_id));
create policy services_insert on public.client_services for insert to authenticated
  with check (private.has_perm(workspace_id, 'clients.manage') and private.can_access_client(workspace_id, client_id));
create policy services_update on public.client_services for update to authenticated
  using (private.has_perm(workspace_id, 'clients.manage') and private.can_access_client(workspace_id, client_id))
  with check (private.has_perm(workspace_id, 'clients.manage'));

create policy targets_select on public.monthly_targets for select to authenticated
  using (private.can_access_client(workspace_id, client_id));
create policy targets_write on public.monthly_targets for all to authenticated
  using (private.has_perm(workspace_id, 'clients.manage') and private.can_access_client(workspace_id, client_id))
  with check (private.has_perm(workspace_id, 'clients.manage') and private.can_access_client(workspace_id, client_id));

-- Formats & templates
create policy formats_select on public.content_formats for select to authenticated
  using (private.is_member(workspace_id));
create policy formats_write on public.content_formats for all to authenticated
  using (private.has_perm(workspace_id, 'workspace.manage'))
  with check (private.has_perm(workspace_id, 'workspace.manage'));
create policy templates_select on public.content_templates for select to authenticated
  using (private.is_member(workspace_id));
create policy templates_write on public.content_templates for all to authenticated
  using (private.has_perm(workspace_id, 'contents.manage'))
  with check (private.has_perm(workspace_id, 'contents.manage'));

-- Contents (insert through create_content RPC)
create policy contents_select on public.content_items for select to authenticated
  using (private.is_member(workspace_id)
         and (private.can_access_client(workspace_id, client_id) or private.is_content_assignee(id)));
create policy contents_update on public.content_items for update to authenticated
  using (private.has_perm(workspace_id, 'contents.manage') and private.can_access_client(workspace_id, client_id))
  with check (private.has_perm(workspace_id, 'contents.manage'));
create policy contents_delete on public.content_items for delete to authenticated
  using (private.has_perm(workspace_id, 'contents.delete') and private.can_access_client(workspace_id, client_id));

create policy content_assignees_select on public.content_assignees for select to authenticated
  using (private.can_access_content(content_id));
create policy content_assignees_insert on public.content_assignees for insert to authenticated
  with check (private.has_perm(workspace_id, 'contents.manage') and private.can_access_content(content_id));
create policy content_assignees_delete on public.content_assignees for delete to authenticated
  using (private.has_perm(workspace_id, 'contents.manage') and private.can_access_content(content_id));

-- Files
create policy files_select on public.file_assets for select to authenticated
  using (private.is_member(workspace_id) and (
           (client_id is not null and private.can_access_client(workspace_id, client_id))
        or (client_id is null and private.has_perm(workspace_id, 'files.manage'))
        or created_by = (select auth.uid())
        or exists (select 1 from public.deliverable_version_assets dva
                   where dva.asset_id = file_assets.id and private.can_access_version(dva.version_id))));
create policy files_insert on public.file_assets for insert to authenticated
  with check (private.is_member(workspace_id)
              and (private.has_perm(workspace_id, 'files.upload') or private.has_perm(workspace_id, 'files.manage'))
              and created_by = (select auth.uid())
              and (client_id is null or private.can_access_client(workspace_id, client_id)
                   or exists (select 1 from public.tasks t where t.client_id = file_assets.client_id
                              and t.assignee_id = (select auth.uid()) and t.status not in ('done', 'cancelled'))));
create policy files_update on public.file_assets for update to authenticated
  using (private.has_perm(workspace_id, 'files.manage') or created_by = (select auth.uid()))
  with check (private.is_member(workspace_id));

-- Deliverables & versions (versions inserted only by RPC)
create policy deliverables_select on public.deliverables for select to authenticated
  using (private.can_access_content(content_id));
create policy deliverables_insert on public.deliverables for insert to authenticated
  with check (private.has_perm(workspace_id, 'contents.manage') and private.can_access_content(content_id));
create policy deliverables_update on public.deliverables for update to authenticated
  using (private.has_perm(workspace_id, 'contents.manage') and private.can_access_content(content_id))
  with check (private.has_perm(workspace_id, 'contents.manage'));

create policy versions_select on public.deliverable_versions for select to authenticated
  using (private.can_access_deliverable(deliverable_id));
create policy version_assets_select on public.deliverable_version_assets for select to authenticated
  using (private.can_access_version(version_id));

-- Tasks
create policy tasks_select on public.tasks for select to authenticated
  using (private.is_member(workspace_id)
         and (assignee_id = (select auth.uid()) or private.can_access_client(workspace_id, client_id)));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (private.has_perm(workspace_id, 'tasks.manage') and private.can_access_client(workspace_id, client_id));
create policy tasks_update on public.tasks for update to authenticated
  using (private.is_member(workspace_id) and (
           (private.has_perm(workspace_id, 'tasks.manage') and private.can_access_client(workspace_id, client_id))
        or assignee_id = (select auth.uid())))
  with check (private.is_member(workspace_id) and (
           private.has_perm(workspace_id, 'tasks.manage') or assignee_id = (select auth.uid())));

create policy task_deps_select on public.task_dependencies for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
create policy task_deps_write on public.task_dependencies for insert to authenticated
  with check (private.has_perm(workspace_id, 'tasks.manage'));
create policy task_deps_delete on public.task_dependencies for delete to authenticated
  using (private.has_perm(workspace_id, 'tasks.manage'));

-- Comments
create policy comments_select on public.comments for select to authenticated
  using (private.can_access_content(content_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = (select auth.uid()) and private.can_access_content(content_id));
create policy comments_update on public.comments for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = (select auth.uid()));

-- Approvals (writes through RPC; responses come from the portal RPCs)
create policy batches_select on public.approval_batches for select to authenticated
  using (private.can_access_client(workspace_id, client_id));
create policy batch_items_select on public.approval_batch_items for select to authenticated
  using (private.can_access_content(content_id));
create policy links_select on public.approval_links for select to authenticated
  using (private.has_perm(workspace_id, 'approvals.manage'));
create policy responses_select on public.approval_responses for select to authenticated
  using (private.can_access_content(content_id));
create policy revisions_select on public.revision_requests for select to authenticated
  using (private.can_access_content(content_id));

-- Notifications (users only touch their own rows; only read_at is updatable)
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

create policy notif_prefs_all on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.is_member(workspace_id));
create policy push_subs_all on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Logs
create policy activity_select on public.activity_logs for select to authenticated
  using (private.is_member(workspace_id) and (
           (content_id is not null and private.can_access_content(content_id))
        or (content_id is null and client_id is not null and private.can_access_client(workspace_id, client_id))
        or (content_id is null and client_id is null and private.has_perm(workspace_id, 'reports.view'))
        or actor_id = (select auth.uid())));
create policy audit_select on public.audit_logs for select to authenticated
  using (private.has_perm(workspace_id, 'audit.view'));

-- Drive (tokens table has NO policies: service role only)
create policy drive_conn_select on public.drive_connections for select to authenticated
  using (private.has_perm(workspace_id, 'integrations.manage') or private.has_perm(workspace_id, 'files.manage'));
create policy drive_maps_select on public.drive_folder_mappings for select to authenticated
  using (private.can_access_client(workspace_id, client_id));
create policy drive_maps_write on public.drive_folder_mappings for all to authenticated
  using (private.has_perm(workspace_id, 'integrations.manage'))
  with check (private.has_perm(workspace_id, 'integrations.manage') and private.can_access_client(workspace_id, client_id));
create policy drive_jobs_select on public.drive_sync_jobs for select to authenticated
  using (private.has_perm(workspace_id, 'files.manage') or private.has_perm(workspace_id, 'integrations.manage'));

-- -----------------------------------------------------------------------------
-- Grants (defense in depth: anon gets nothing on tables; portal uses RPCs)
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema private from anon, authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke update on public.content_items from authenticated;
grant update (title, objective, description, briefing, script, priority, due_at, planned_publish_at,
              channel, service_id, thumbnail_asset_id, archived_at, published_url)
  on public.content_items to authenticated;
revoke all on public.drive_credentials from authenticated;
revoke all on public.background_jobs from authenticated;
revoke all on public.approval_link_sessions from authenticated;

grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on function
  private.is_member(uuid), private.has_perm(uuid, text), private.can_access_client(uuid, uuid),
  private.is_content_assignee(uuid), private.can_access_content(uuid), private.can_access_deliverable(uuid),
  private.can_access_version(uuid), private.shares_workspace(uuid), private.state_change_allowed()
to authenticated;
