-- =============================================================================
-- Delta Flow — 0018 Google Agenda (per person)
--   * calendar_connections: one per member; settings the person controls.
--   * calendar_credentials: encrypted OAuth tokens. Service role only.
--   * calendar_event_links: which Google event mirrors which task / post,
--     so syncing updates or deletes instead of duplicating. Service role only.
-- Idempotent.
-- =============================================================================
create table if not exists public.calendar_connections (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  google_email     text not null,
  google_sub       text not null,
  status           text not null default 'active' check (status in ('active', 'error', 'revoked')),
  last_error       text,
  share_with_team  boolean not null default true,
  push_tasks       boolean not null default true,
  push_posts       boolean not null default true,
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  unique (workspace_id, user_id)
);
alter table public.calendar_connections enable row level security;

create table if not exists public.calendar_credentials (
  connection_id            uuid primary key references public.calendar_connections(id) on delete cascade,
  refresh_token_encrypted  text not null,
  access_token_encrypted   text,
  access_token_expires_at  timestamptz,
  updated_at               timestamptz not null default now()
);
alter table public.calendar_credentials enable row level security;

create table if not exists public.calendar_event_links (
  connection_id    uuid not null references public.calendar_connections(id) on delete cascade,
  source_type      text not null check (source_type in ('task', 'post')),
  source_id        uuid not null,
  google_event_id  text not null,
  payload_hash     text not null,
  updated_at       timestamptz not null default now(),
  primary key (connection_id, source_type, source_id)
);
alter table public.calendar_event_links enable row level security;

-- The owner reads and edits their settings; teammates only learn whether it is shared.
drop policy if exists calendar_select on public.calendar_connections;
create policy calendar_select on public.calendar_connections for select to authenticated
  using (user_id = (select auth.uid()) or (share_with_team and private.is_member(workspace_id)));
drop policy if exists calendar_update on public.calendar_connections;
create policy calendar_update on public.calendar_connections for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.calendar_connections, public.calendar_credentials, public.calendar_event_links from anon, authenticated;
grant select on public.calendar_connections to authenticated;
grant update (share_with_team, push_tasks, push_posts) on public.calendar_connections to authenticated;
grant all on public.calendar_connections, public.calendar_credentials, public.calendar_event_links to service_role;
