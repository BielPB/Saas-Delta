-- =============================================================================
-- Delta Flow — 0003 Approvals, revisions, notifications, jobs, logs, Drive
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Approval batches & secure links
-- -----------------------------------------------------------------------------
create table public.approval_batches (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  client_id     uuid not null,
  name          text not null check (char_length(name) between 1 and 160),
  due_at        timestamptz,
  status        text not null default 'open' check (status in ('open', 'submitted', 'closed')),
  submitted_at  timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete cascade
);
create index approval_batches_client_idx on public.approval_batches (workspace_id, client_id, created_at desc);

create table public.approval_batch_items (
  workspace_id  uuid not null,
  batch_id      uuid not null,
  content_id    uuid not null,
  position      smallint not null default 0,
  primary key (batch_id, content_id),
  foreign key (workspace_id, batch_id)   references public.approval_batches(workspace_id, id) on delete cascade,
  foreign key (workspace_id, content_id) references public.content_items(workspace_id, id) on delete cascade
);
create index approval_batch_items_content_idx on public.approval_batch_items (content_id);

-- Tokens are NEVER stored in plain text: only sha256(token).
create table public.approval_links (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  batch_id         uuid not null,
  token_hash       bytea not null unique,
  token_hint       text not null,                    -- last 4 chars, for support only
  pin_hash         text,                             -- bcrypt via pgcrypto crypt()
  expires_at       timestamptz,
  revoked_at       timestamptz,
  revoked_by       uuid references auth.users(id) on delete set null,
  failed_attempts  integer not null default 0,
  locked_until     timestamptz,
  last_accessed_at timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, batch_id) references public.approval_batches(workspace_id, id) on delete cascade
);

-- Short-lived portal sessions issued after the token (and PIN) are verified.
create table public.approval_link_sessions (
  id            uuid primary key default gen_random_uuid(),
  link_id       uuid not null references public.approval_links(id) on delete cascade,
  session_hash  bytea not null unique,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);
create index approval_link_sessions_link_idx on public.approval_link_sessions (link_id);

-- Revision requests: one per rejected version (client) or per explicit
-- invalidation (internal). Guarantees idempotent adjustment-task creation.
create table public.revision_requests (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  content_id      uuid not null,
  deliverable_id  uuid not null,
  version_id      uuid not null,
  source          text not null check (source in ('client', 'internal')),
  reason          text not null check (char_length(reason) between 1 and 5000),
  status          text not null default 'open' check (status in ('open', 'resolved', 'cancelled')),
  task_id         uuid,
  requested_by    uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, content_id)     references public.content_items(workspace_id, id) on delete cascade,
  foreign key (workspace_id, deliverable_id) references public.deliverables(workspace_id, id) on delete cascade,
  foreign key (workspace_id, version_id)     references public.deliverable_versions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, task_id)        references public.tasks(workspace_id, id) on delete set null (task_id)
);
-- At most ONE open revision per version: duplicates are impossible.
create unique index revision_requests_open_version_uq on public.revision_requests (version_id) where status = 'open';
create index revision_requests_content_idx on public.revision_requests (content_id, status);

alter table public.tasks
  add constraint tasks_revision_request_fk
  foreign key (workspace_id, revision_request_id) references public.revision_requests(workspace_id, id) on delete set null (revision_request_id);
create unique index tasks_revision_request_uq on public.tasks (revision_request_id) where revision_request_id is not null;

-- Client decisions: append-only, bound to the EXACT version shown.
create table public.approval_responses (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  link_id          uuid not null,
  batch_id         uuid not null,
  content_id       uuid not null,
  deliverable_id   uuid not null,
  version_id       uuid not null,
  decision         text not null check (decision in ('approved', 'rejected')),
  comment          text check (comment is null or char_length(comment) <= 5000),
  reviewer_name    text check (reviewer_name is null or char_length(reviewer_name) <= 120),
  idempotency_key  text not null check (char_length(idempotency_key) between 8 and 120),
  revision_request_id uuid,
  created_at       timestamptz not null default now(),
  unique (workspace_id, id),
  unique (link_id, idempotency_key),
  foreign key (workspace_id, link_id)        references public.approval_links(workspace_id, id) on delete cascade,
  foreign key (workspace_id, version_id)     references public.deliverable_versions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, revision_request_id) references public.revision_requests(workspace_id, id) on delete set null (revision_request_id),
  check (decision <> 'rejected' or (comment is not null and char_length(btrim(comment)) >= 3))
);
create index approval_responses_version_idx on public.approval_responses (version_id, created_at desc);
create index approval_responses_batch_idx on public.approval_responses (batch_id);

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------
create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  type          text not null,
  category      text not null default 'tasks' check (category in ('tasks', 'approvals', 'publications', 'files', 'system')),
  title         text not null,
  body          text,
  link          text,
  entity_type   text,
  entity_id     uuid,
  dedupe_key    text not null,
  read_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_unread_idx on public.notifications (user_id, workspace_id, created_at desc) where read_at is null;
create index notifications_user_idx on public.notifications (user_id, workspace_id, created_at desc);

create table public.notification_preferences (
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  category      text not null check (category in ('tasks', 'approvals', 'publications', 'files', 'system')),
  in_app        boolean not null default true,
  email         boolean not null default false,
  push          boolean not null default false,
  primary key (workspace_id, user_id, category)
);

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  keys        jsonb not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Background jobs (outbox). Consumed by a worker with the service role.
-- -----------------------------------------------------------------------------
create table public.background_jobs (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid references public.workspaces(id) on delete cascade,
  type             text not null check (type in ('send_email', 'send_push', 'drive_sync', 'generate_preview', 'scan_overdue')),
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'dead')),
  attempts         integer not null default 0,
  max_attempts     integer not null default 5,
  run_after        timestamptz not null default now(),
  locked_at        timestamptz,
  last_error       text,
  idempotency_key  text not null unique,
  created_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index background_jobs_queue_idx on public.background_jobs (status, run_after) where status in ('queued', 'failed');

-- -----------------------------------------------------------------------------
-- Activity (product history) & audit (security trail)
-- -----------------------------------------------------------------------------
create table public.activity_logs (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  actor_id      uuid references auth.users(id) on delete set null,
  actor_type    text not null default 'user' check (actor_type in ('user', 'client', 'system')),
  actor_label   text,
  client_id     uuid,
  content_id    uuid,
  entity_type   text not null,
  entity_id     uuid,
  action        text not null,
  data          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index activity_logs_ws_idx      on public.activity_logs (workspace_id, created_at desc);
create index activity_logs_content_idx on public.activity_logs (content_id, created_at desc) where content_id is not null;
create index activity_logs_client_idx  on public.activity_logs (client_id, created_at desc) where client_id is not null;

create table public.audit_logs (
  id            bigint generated always as identity primary key,
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  actor_id      uuid references auth.users(id) on delete set null,
  action        text not null,
  entity_type   text,
  entity_id     uuid,
  data          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index audit_logs_ws_idx on public.audit_logs (workspace_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Google Drive integration
-- Tokens live in drive_credentials: RLS enabled, NO policies => only the
-- service role (server) can read them. Values are AES-256-GCM encrypted by
-- the application before insert (DRIVE_TOKEN_ENCRYPTION_KEY).
-- -----------------------------------------------------------------------------
create table public.drive_connections (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  google_email   text not null,
  google_sub     text not null,
  scopes         text[] not null default '{}',
  status         text not null default 'active' check (status in ('active', 'error', 'revoked')),
  last_error     text,
  connected_by   uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, google_sub)
);
create trigger drive_connections_touch before update on public.drive_connections
  for each row execute function private.touch_updated_at();

create table public.drive_credentials (
  connection_id            uuid primary key references public.drive_connections(id) on delete cascade,
  refresh_token_encrypted  text not null,
  access_token_encrypted   text,
  access_token_expires_at  timestamptz,
  updated_at               timestamptz not null default now()
);

create table public.drive_folder_mappings (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  connection_id    uuid not null,
  drive_folder_id  text not null,
  folder_name      text not null,
  folder_path      text,
  client_id        uuid not null,
  service_id       uuid,
  category         text check (category in ('raw', 'edited_video', 'cover', 'image', 'carousel', 'script', 'document', 'approved', 'brand')),
  monitored        boolean not null default true,
  last_synced_at   timestamptz,
  page_token       text,
  created_at       timestamptz not null default now(),
  unique (workspace_id, drive_folder_id),
  unique (workspace_id, id),
  foreign key (workspace_id, connection_id) references public.drive_connections(workspace_id, id) on delete cascade,
  foreign key (workspace_id, client_id)     references public.clients(workspace_id, id) on delete cascade,
  foreign key (client_id, service_id)       references public.client_services(client_id, id) on delete set null (service_id)
);

create table public.drive_sync_jobs (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  mapping_id     uuid not null,
  trigger        text not null default 'manual' check (trigger in ('manual', 'scheduled')),
  status         text not null default 'running' check (status in ('running', 'done', 'failed')),
  files_seen     integer not null default 0,
  files_new      integer not null default 0,
  files_missing  integer not null default 0,
  error          text,
  started_by     uuid references auth.users(id) on delete set null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  foreign key (workspace_id, mapping_id) references public.drive_folder_mappings(workspace_id, id) on delete cascade
);
create index drive_sync_jobs_mapping_idx on public.drive_sync_jobs (mapping_id, started_at desc);
-- Only one running sync per folder at a time.
create unique index drive_sync_jobs_running_uq on public.drive_sync_jobs (mapping_id) where status = 'running';

-- Generic fixed-window rate limiter (portal, auth-adjacent endpoints).
create table private.rate_limits (
  bucket        text primary key,
  window_start  timestamptz not null,
  hits          integer not null
);
