-- =============================================================================
-- Delta Flow — 0016 Post status = pipeline column
-- The manual status of a post now matches the production columns of the board:
--   script (Roteiro) → capture (Gravação) → editing (Edição) → finishing (Finalização).
-- From approval on, the status stays derived (with the client, adjustments,
-- ready, scheduled, published). Old values are migrated:
--   planning → script, production → editing, review → finishing.
-- Idempotent.
-- =============================================================================
alter table public.content_items drop constraint if exists content_items_work_status_chk;
update public.content_items set work_status = case work_status
  when 'planning' then 'script' when 'production' then 'editing' when 'review' then 'finishing' else work_status end
 where work_status in ('planning', 'production', 'review');
alter table public.content_items alter column work_status set default 'script';
alter table public.content_items add constraint content_items_work_status_chk
  check (work_status in ('script', 'capture', 'editing', 'finishing'));

create or replace function public.set_work_status(p_content uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.content_items%rowtype;
begin
  select * into c from public.content_items where id = p_content;
  if not found or not private.can_access_content(p_content) then perform private.fail('not_found', 'content'); end if;
  if p_status not in ('script', 'capture', 'editing', 'finishing') then perform private.fail('validation', 'status'); end if;
  if not (private.has_perm(c.workspace_id, 'contents.manage')
          or c.editor_id = auth.uid()
          or exists (select 1 from public.content_assignees a where a.content_id = p_content and a.user_id = auth.uid())
          or exists (select 1 from public.tasks t where t.content_id = p_content and t.assignee_id = auth.uid() and t.status not in ('done', 'cancelled'))) then
    perform private.fail('permission_denied', 'status');
  end if;
  if c.publication_status in ('published', 'cancelled') then perform private.fail('invalid_transition', 'content_published'); end if;
  update public.content_items set work_status = p_status where id = p_content;
  perform private.log_activity(c.workspace_id, 'content', p_content, 'content.status_set', c.client_id, p_content,
                               jsonb_build_object('status', p_status));
end $$;

-- submit_for_approval (0013) set 'review'; keep its body and only change that value.
do $$
declare src text;
begin
  select pg_get_functiondef('public.submit_for_approval(uuid)'::regprocedure) into src;
  if position($q$work_status = 'review'$q$ in src) > 0 then
    execute replace(src, $q$work_status = 'review'$q$, $q$work_status = 'finishing'$q$);
  end if;
end $$;
