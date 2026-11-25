-- =============================================================================
-- Delta Flow — 0014 Client onboarding, client profile ("ficha") and member goals
--   * clients.onboarding: per-client checklist [{id, label, done}] (empty = default list).
--   * clients.profile: brand sheet (about, audience, tone of voice, palette…).
--     Never meant for passwords: the UI says so explicitly.
--   * workspace_members.monthly_target: approved posts per month for the team ranking.
-- Idempotent.
-- =============================================================================
alter table public.clients add column if not exists onboarding jsonb not null default '[]'::jsonb;
alter table public.clients add column if not exists profile jsonb not null default '{}'::jsonb;
do $$ begin
  alter table public.clients add constraint clients_onboarding_is_array check (jsonb_typeof(onboarding) = 'array');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.clients add constraint clients_profile_is_object check (jsonb_typeof(profile) = 'object');
exception when duplicate_object then null; end $$;

alter table public.workspace_members add column if not exists monthly_target integer;
do $$ begin
  alter table public.workspace_members add constraint workspace_members_target_chk check (monthly_target is null or monthly_target between 0 and 1000);
exception when duplicate_object then null; end $$;

-- Members are written only through RPCs (0004): goal setting gets its own.
create or replace function public.set_member_target(p_ws uuid, p_user uuid, p_target integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_perm(p_ws, 'members.manage');
  if p_target is not null and (p_target < 0 or p_target > 1000) then perform private.fail('validation', 'target'); end if;
  update public.workspace_members set monthly_target = p_target where workspace_id = p_ws and user_id = p_user;
  if not found then perform private.fail('not_found', 'member'); end if;
end $$;
revoke all on function public.set_member_target(uuid, uuid, integer) from public, anon;
grant execute on function public.set_member_target(uuid, uuid, integer) to authenticated;
