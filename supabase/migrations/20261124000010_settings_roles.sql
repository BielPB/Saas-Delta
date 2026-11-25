-- =============================================================================
-- Delta Flow — 0010 Settings hardening & custom roles
-- =============================================================================

-- Only presentation/config columns are editable by members with workspace.manage.
-- plan, limits, slug and content_counter are platform-controlled (billing-ready).
revoke update on public.workspaces from authenticated;
grant update (name, logo_path, brand_color, timezone, locale, onboarding) on public.workspaces to authenticated;
revoke update on public.workspace_settings from authenticated;
grant update (approval_default_expiry_days, approval_require_pin, approval_stale_after_days, notify_email_enabled,
              week_starts_on, data_retention_months, extra) on public.workspace_settings to authenticated;

-- Custom roles with granular permissions. System roles keep their key; owner is immutable.
create or replace function public.save_role(
  p_ws uuid, p_key text, p_name text, p_description text, p_permissions text[], p_produces public.deliverable_kind[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_role uuid; v_system boolean;
begin
  perform private.require_perm(p_ws, 'roles.manage');
  if p_key = 'owner' then perform private.fail('invalid_transition', 'owner role is immutable'); end if;
  if p_key !~ '^[a-z0-9_]{2,40}$' or char_length(coalesce(btrim(p_name), '')) < 2 then perform private.fail('validation', 'role'); end if;
  if exists (select 1 from unnest(p_permissions) x where x not in (select key from public.permissions)) then
    perform private.fail('validation', 'permission');
  end if;
  -- Nobody grants permissions they do not hold themselves.
  if exists (select 1 from unnest(p_permissions) x where not private.has_perm(p_ws, x)) then
    perform private.fail('permission_denied', 'cannot grant permissions you do not have');
  end if;

  select id, is_system into v_role, v_system from public.roles where workspace_id = p_ws and key = p_key for update;
  if v_role is null then
    insert into public.roles (workspace_id, key, name, description, is_system, produces_kinds)
    values (p_ws, p_key, btrim(p_name), p_description, false, coalesce(p_produces, '{}')) returning id into v_role;
  else
    update public.roles set name = btrim(p_name), description = p_description, produces_kinds = coalesce(p_produces, '{}') where id = v_role;
  end if;
  delete from public.role_permissions where role_id = v_role;
  insert into public.role_permissions (role_id, permission_key) select v_role, unnest(p_permissions);
  perform private.audit(p_ws, 'role.saved', 'role', v_role, jsonb_build_object('key', p_key, 'permissions', p_permissions));
  return v_role;
end $$;

create or replace function public.delete_role(p_ws uuid, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.roles%rowtype;
begin
  perform private.require_perm(p_ws, 'roles.manage');
  select * into r from public.roles where workspace_id = p_ws and key = p_key for update;
  if not found then perform private.fail('not_found', 'role'); end if;
  if r.is_system then perform private.fail('invalid_transition', 'system roles cannot be deleted'); end if;
  if exists (select 1 from public.member_roles where role_id = r.id) then
    perform private.fail('invalid_transition', 'role in use');
  end if;
  delete from public.roles where id = r.id;
  perform private.audit(p_ws, 'role.deleted', 'role', r.id, jsonb_build_object('key', p_key));
end $$;

revoke all on function public.save_role(uuid, text, text, text, text[], public.deliverable_kind[]) from public, anon;
revoke all on function public.delete_role(uuid, text) from public, anon;
grant execute on function public.save_role(uuid, text, text, text, text[], public.deliverable_kind[]) to authenticated;
grant execute on function public.delete_role(uuid, text) to authenticated;
