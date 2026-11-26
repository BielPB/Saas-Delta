-- =============================================================================
-- 0021 — Allow deleting a user (Supabase → Authentication → Users → Delete).
-- History rows keep their content when a user is deleted: the foreign keys are
-- "on delete set null", so Postgres clears actor_id / author_id / assignee_id…
-- But the append-only and state guards rejected that UPDATE and the delete
-- failed with "Database error deleting user".
-- The guards now skip an UPDATE whose ONLY change is clearing references to
-- users that NO LONGER EXIST (the FK action runs after the user row is gone).
-- Anything else (content, status, unassigning a live user) is still blocked.
-- =============================================================================

create or replace function private.only_user_refs_cleared(o jsonb, n jsonb)
returns boolean language sql stable security definer set search_path = '' as $$
  select o is distinct from n and not exists (
    select 1 from jsonb_each(o) e
     where e.value is distinct from (n -> e.key)
       and not (e.key = any (array['actor_id', 'author_id', 'released_by', 'assignee_id', 'completed_by',
                                   'created_by', 'scheduled_by', 'published_by', 'editor_id', 'requested_by',
                                   'revoked_by', 'connected_by', 'started_by', 'invited_by'])
                and (n -> e.key) = 'null'::jsonb
                and not exists (select 1 from auth.users u where u.id::text = e.value #>> '{}'))
  )
$$;

-- tasks / content_items: same guard functions, skipped for user-reference clean-up.
drop trigger if exists tasks_guard on public.tasks;
create trigger tasks_guard before update on public.tasks
  for each row when (not private.only_user_refs_cleared(to_jsonb(old), to_jsonb(new)))
  execute function private.guard_task_state();

drop trigger if exists content_items_guard on public.content_items;
create trigger content_items_guard before update on public.content_items
  for each row when (not private.only_user_refs_cleared(to_jsonb(old), to_jsonb(new)))
  execute function private.guard_content_state();

-- Versions: delete always blocked; updates allowed only for user-reference clean-up or workflow.
drop trigger if exists deliverable_versions_immutable on public.deliverable_versions;
create trigger deliverable_versions_immutable before update on public.deliverable_versions
  for each row when (not private.only_user_refs_cleared(to_jsonb(old), to_jsonb(new)))
  execute function private.guard_version_immutable();
create trigger deliverable_versions_no_delete before delete on public.deliverable_versions
  for each row execute function private.guard_version_immutable();

-- Logs: append-only, except clearing the actor of a deleted user.
drop trigger if exists activity_logs_append_only on public.activity_logs;
create trigger activity_logs_append_only before update on public.activity_logs
  for each row when (not private.only_user_refs_cleared(to_jsonb(old), to_jsonb(new)))
  execute function private.guard_append_only();
create trigger activity_logs_no_delete before delete on public.activity_logs
  for each row execute function private.guard_append_only();

drop trigger if exists audit_logs_append_only on public.audit_logs;
create trigger audit_logs_append_only before update on public.audit_logs
  for each row when (not private.only_user_refs_cleared(to_jsonb(old), to_jsonb(new)))
  execute function private.guard_append_only();
create trigger audit_logs_no_delete before delete on public.audit_logs
  for each row execute function private.guard_append_only();
