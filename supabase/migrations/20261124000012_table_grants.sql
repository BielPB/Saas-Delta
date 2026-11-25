-- =============================================================================
-- Delta Flow — 0012 Explicit table grants for Supabase projects.
-- Earlier migrations assumed Supabase's default privileges (GRANT ALL on new
-- public tables to authenticated/service_role). Current projects do not apply
-- them, so every query failed with 42501 "permission denied for table".
-- Row access remains governed by RLS; this only restores table-level privileges
-- and then re-applies the column/table restrictions from 0004 and 0010.
-- Idempotent.
-- =============================================================================
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;

-- Re-apply restrictions (0004)
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke update on public.content_items from authenticated;
grant update (title, objective, description, briefing, script, priority, due_at, planned_publish_at,
              channel, service_id, thumbnail_asset_id, archived_at, published_url)
  on public.content_items to authenticated;
revoke all on public.drive_credentials from authenticated;
revoke all on public.background_jobs from authenticated;
revoke all on public.approval_link_sessions from authenticated;

-- Re-apply restrictions (0010)
revoke update on public.workspaces from authenticated;
grant update (name, logo_path, brand_color, timezone, locale, onboarding) on public.workspaces to authenticated;
revoke update on public.workspace_settings from authenticated;
grant update (approval_default_expiry_days, approval_require_pin, approval_stale_after_days, notify_email_enabled,
              week_starts_on, data_retention_months, extra) on public.workspace_settings to authenticated;

-- anon never gets table access (the approval portal uses RPCs).
revoke all on all tables in schema public from anon;
