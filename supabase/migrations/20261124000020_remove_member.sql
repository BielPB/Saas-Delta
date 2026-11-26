-- =============================================================================
-- 0020 — Remove a person from the workspace ("Remover da equipe").
--   * Invited (never signed in): the invite is cancelled.
--   * Active / disabled: the membership is deleted, so the person loses access.
--     History stays (done tasks, comments, audit); open tasks go back to
--     "sem responsável" so nothing is left assigned to someone who is gone.
--     Client allocations and post assignments cascade (FKs on workspace_members).
--     Their Google Agenda link to this workspace is dropped.
--   * Nobody removes themselves; only owners remove an owner; the last owner stays.
-- =============================================================================

create or replace function public.remove_member(p_ws uuid, p_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_email text; v_is_owner boolean;
begin
  perform private.require_perm(p_ws, 'members.manage');
  select user_id, invited_email into v_user, v_email
    from public.workspace_members where id = p_member and workspace_id = p_ws for update;
  if not found then perform private.fail('not_found', 'member'); end if;
  if v_user = auth.uid() then perform private.fail('cannot_remove_self'); end if;

  select exists (select 1 from public.member_roles mr join public.roles r on r.id = mr.role_id
                 where mr.member_id = p_member and r.key = 'owner') into v_is_owner;
  if v_is_owner then
    if not exists (select 1 from public.workspace_members m join public.member_roles mr on mr.member_id = m.id
                   join public.roles r on r.id = mr.role_id
                   where m.workspace_id = p_ws and m.user_id = auth.uid() and r.key = 'owner') then
      perform private.fail('permission_denied', 'only owners remove owners');
    end if;
    if v_user is not null and (
       select count(*) from public.member_roles mr join public.roles r on r.id = mr.role_id
         join public.workspace_members m on m.id = mr.member_id
        where r.workspace_id = p_ws and r.key = 'owner' and m.status = 'active' and m.id <> p_member) = 0 then
      perform private.fail('last_owner');
    end if;
  end if;

  if v_user is not null then
    update public.tasks set assignee_id = null
     where workspace_id = p_ws and assignee_id = v_user and status not in ('done', 'cancelled');
    delete from public.calendar_connections where workspace_id = p_ws and user_id = v_user;
  end if;

  delete from public.workspace_members where id = p_member;
  perform private.audit(p_ws, 'member.removed', 'member', p_member,
    jsonb_build_object('user_id', v_user, 'email', v_email));
end $$;

revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
