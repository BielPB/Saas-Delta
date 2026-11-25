-- =============================================================================
-- Delta Flow — 0017 Completing a post task advances the post
-- A general task linked to a post can carry the post stage it belongs to
-- (tasks.step_key = script | capture | editing | finishing). When it is
-- completed, the post moves to the NEXT stage — never backwards, never past
-- Finalização (sending to the client stays an explicit action), and only for
-- posts that use the simple workflow (no task template).
-- Idempotent.
-- =============================================================================
create or replace function private.advance_post_on_task_done()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.content_items%rowtype;
  v_order text[] := array['script', 'capture', 'editing', 'finishing'];
  v_task_pos integer; v_post_pos integer; v_next text;
begin
  if new.status <> 'done' or old.status = 'done' or new.kind <> 'general' or new.content_id is null then return new; end if;
  v_task_pos := array_position(v_order, new.step_key);
  if v_task_pos is null then return new; end if;

  select * into c from public.content_items where id = new.content_id for update;
  if not found or c.template_id is not null or c.publication_status in ('published', 'cancelled', 'scheduled')
     or c.approval_status in ('awaiting', 'partially_approved', 'rejected', 'approved') then
    return new;
  end if;

  v_post_pos := coalesce(array_position(v_order, c.work_status), 1);
  v_next := v_order[least(v_task_pos + 1, array_length(v_order, 1))];
  if array_position(v_order, v_next) > v_post_pos then
    update public.content_items set work_status = v_next where id = c.id;
    perform private.log_activity(c.workspace_id, 'content', c.id, 'content.status_set', c.client_id, c.id,
                                 jsonb_build_object('status', v_next, 'via_task', new.id));
  end if;
  return new;
end $$;

drop trigger if exists tasks_advance_post on public.tasks;
create trigger tasks_advance_post after update of status on public.tasks
  for each row execute function private.advance_post_on_task_done();
