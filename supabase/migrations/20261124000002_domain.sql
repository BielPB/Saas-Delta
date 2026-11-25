-- =============================================================================
-- Delta Flow — 0002 Operational domain
-- Clients, services, formats, templates, targets, contents, deliverables,
-- versions, files, tasks, comments.
--
-- The CONTENT (content_items) is the central entity. A content has
-- deliverables (video, cover, caption...). Each deliverable has immutable
-- versions. Tasks produce deliverables. Reports count CONTENTS, never
-- deliverables.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Clients & services
-- -----------------------------------------------------------------------------
create table public.clients (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 160),
  company_name     text,
  logo_path        text,
  segment          text,
  contact_name     text,
  phone            text,
  email            text,
  instagram        text,
  website          text,
  contract_start   date,
  status           public.client_status not null default 'active',
  monthly_target   integer not null default 0 check (monthly_target >= 0),
  notes            text,
  -- Sensitive material (e.g. patient images): approval links REQUIRE a PIN and
  -- an expiry date. Enforced in create_approval_batch().
  is_sensitive     boolean not null default false,
  drive_folder_id  text,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  unique (workspace_id, id)
);
create index clients_ws_status_idx on public.clients (workspace_id, status);
create index clients_ws_name_idx on public.clients (workspace_id, lower(name));
create trigger clients_touch before update on public.clients
  for each row execute function private.touch_updated_at();

-- Collaborators allocated to a client. Members without clients.view_all only
-- see the clients they are allocated to.
create table public.client_members (
  workspace_id  uuid not null,
  client_id     uuid not null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (client_id, user_id),
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete cascade,
  foreign key (workspace_id, user_id)   references public.workspace_members(workspace_id, user_id) on delete cascade
);
create index client_members_user_idx on public.client_members (user_id, workspace_id);

create table public.client_services (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  client_id        uuid not null,
  name             text not null check (char_length(name) between 1 and 120),
  description      text,
  color            text not null default '#737373' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  monthly_target   integer check (monthly_target is null or monthly_target >= 0),
  drive_folder_id  text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, id),
  unique (client_id, id),
  unique (client_id, name),
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete cascade
);
create trigger client_services_touch before update on public.client_services
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Formats & templates (configurable pipeline per format)
-- -----------------------------------------------------------------------------
create table public.content_formats (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  key             text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  name            text not null,
  -- Deliverables that must exist (and be approved, when client-facing)
  -- before a content of this format can advance.
  required_kinds  public.deliverable_kind[] not null default '{}',
  aspect_ratio    text check (aspect_ratio in ('9:16', '4:5', '1:1', '16:9')),
  active          boolean not null default true,
  is_system       boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, key)
);

-- steps: [{ "key": "capture", "title": "Captação", "role_key": "filmmaker",
--           "deliverable_kind": "raw_footage", "depends_on": ["script"],
--           "offset_days": 3, "kind": "production" }]
create table public.content_templates (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  format_id     uuid not null,
  name          text not null,
  description   text,
  steps         jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  active        boolean not null default true,
  is_system     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, name),
  foreign key (workspace_id, format_id) references public.content_formats(workspace_id, id) on delete restrict
);
create trigger content_templates_touch before update on public.content_templates
  for each row execute function private.touch_updated_at();

-- Targets per client / service / format / month. NULL service or format means
-- "any". NULLS NOT DISTINCT keeps one target per combination.
create table public.monthly_targets (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  client_id     uuid not null,
  service_id    uuid,
  format_id     uuid,
  month         date not null check (extract(day from month) = 1),
  target        integer not null check (target >= 0),
  created_at    timestamptz not null default now(),
  unique nulls not distinct (client_id, service_id, format_id, month),
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete cascade,
  foreign key (client_id, service_id)   references public.client_services(client_id, id) on delete cascade,
  foreign key (workspace_id, format_id) references public.content_formats(workspace_id, id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- Contents
-- -----------------------------------------------------------------------------
create table public.content_items (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null,
  client_id             uuid not null,
  service_id            uuid,
  format_id             uuid not null,
  template_id           uuid,
  code                  integer not null,
  title                 text not null check (char_length(title) between 1 and 200),
  objective             text,
  description           text,
  briefing              text,
  script                text,
  priority              public.priority_level not null default 'medium',
  due_at                timestamptz,                 -- production deadline
  planned_publish_at    timestamptz,                 -- editorial intent
  scheduled_at          timestamptz,                 -- confirmed external schedule
  scheduled_by          uuid references auth.users(id) on delete set null,
  published_at          timestamptz,                 -- effective date (confirmed)
  published_by          uuid references auth.users(id) on delete set null,
  published_url         text,
  channel               text check (channel in ('instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'meta_ads', 'google_ads', 'other')),
  production_status     public.production_status  not null default 'planned',
  approval_status       public.approval_status    not null default 'not_sent',
  publication_status    public.publication_status not null default 'unscheduled',
  stage                 public.content_stage      not null default 'planning',
  publish_override_reason text,
  thumbnail_asset_id    uuid,
  lock_version          integer not null default 1,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, code),
  foreign key (workspace_id, client_id)   references public.clients(workspace_id, id) on delete cascade,
  foreign key (client_id, service_id)     references public.client_services(client_id, id) on delete set null (service_id),
  foreign key (workspace_id, format_id)   references public.content_formats(workspace_id, id) on delete restrict,
  foreign key (workspace_id, template_id) references public.content_templates(workspace_id, id) on delete set null (template_id),
  check (publication_status <> 'published' or published_at is not null),
  check (publication_status <> 'scheduled' or scheduled_at is not null)
);
create index content_items_ws_client_idx   on public.content_items (workspace_id, client_id) where archived_at is null;
create index content_items_ws_stage_idx    on public.content_items (workspace_id, stage) where archived_at is null;
create index content_items_ws_planned_idx  on public.content_items (workspace_id, planned_publish_at) where archived_at is null;
create index content_items_service_idx     on public.content_items (service_id);
create index content_items_title_idx       on public.content_items (workspace_id, lower(title));

create table public.content_assignees (
  workspace_id  uuid not null,
  content_id    uuid not null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (content_id, user_id),
  foreign key (workspace_id, content_id) references public.content_items(workspace_id, id) on delete cascade,
  foreign key (workspace_id, user_id)    references public.workspace_members(workspace_id, user_id) on delete cascade
);
create index content_assignees_user_idx on public.content_assignees (user_id);

-- -----------------------------------------------------------------------------
-- Files (hybrid storage: Supabase private bucket, Google Drive references,
-- external links). Provider-agnostic so R2/S3/Mux can be added later.
-- -----------------------------------------------------------------------------
create table public.file_assets (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  client_id        uuid,
  service_id       uuid,
  provider         public.asset_provider not null,
  storage_bucket   text,
  storage_path     text,
  drive_file_id    text,
  drive_parent_id  text,
  external_url     text,
  name             text not null,
  mime_type        text,
  size_bytes       bigint check (size_bytes is null or size_bytes >= 0),
  checksum         text,
  width            integer,
  height           integer,
  duration_seconds numeric(10,2),
  category         text not null default 'document' check (category in
                     ('raw', 'edited_video', 'cover', 'image', 'carousel', 'script', 'document', 'approved', 'brand')),
  status           public.asset_status not null default 'available',
  thumbnail_path   text,
  preview_path     text,
  drive_thumbnail_url text,
  drive_modified_at timestamptz,
  last_seen_at     timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete cascade,
  foreign key (client_id, service_id)   references public.client_services(client_id, id) on delete set null (service_id),
  check (
    (provider = 'supabase'      and storage_path  is not null) or
    (provider = 'drive'         and drive_file_id is not null) or
    (provider = 'external_link' and external_url  is not null)
  )
);
-- Anti-duplication: the same Drive file / storage object can only be imported once.
-- Full (non-partial) unique constraints so PostgREST upserts can target them; NULLs never collide.
alter table public.file_assets add constraint file_assets_drive_uq unique (workspace_id, drive_file_id);
alter table public.file_assets add constraint file_assets_storage_uq unique (storage_bucket, storage_path);
create index file_assets_ws_client_idx on public.file_assets (workspace_id, client_id, category);
create trigger file_assets_touch before update on public.file_assets
  for each row execute function private.touch_updated_at();

alter table public.content_items
  add constraint content_items_thumbnail_fk
  foreign key (workspace_id, thumbnail_asset_id) references public.file_assets(workspace_id, id) on delete set null (thumbnail_asset_id);

-- -----------------------------------------------------------------------------
-- Deliverables & immutable versions
-- -----------------------------------------------------------------------------
create table public.deliverables (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  content_id          uuid not null,
  kind                public.deliverable_kind not null,
  title               text not null,
  required            boolean not null default true,
  -- Client-facing deliverables go through the approval portal.
  client_facing       boolean not null default true,
  responsible_role_key text,
  assignee_id         uuid references auth.users(id) on delete set null,
  current_version_id  uuid,
  approval_status     public.version_status not null default 'pending',
  position            smallint not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (workspace_id, id),
  unique (content_id, id),
  unique (content_id, kind, title),
  foreign key (workspace_id, content_id) references public.content_items(workspace_id, id) on delete cascade
);
create index deliverables_content_idx on public.deliverables (content_id);
create trigger deliverables_touch before update on public.deliverables
  for each row execute function private.touch_updated_at();

create table public.deliverable_versions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  deliverable_id  uuid not null,
  version_number  integer not null check (version_number >= 1),
  text_content    text,
  external_url    text,
  author_id       uuid references auth.users(id) on delete set null,
  change_reason   text,
  status          public.version_status not null default 'pending',
  -- Set when internal review releases the version to the client portal.
  released_at     timestamptz,
  released_by     uuid references auth.users(id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (workspace_id, id),
  unique (deliverable_id, id),
  unique (deliverable_id, version_number),
  foreign key (workspace_id, deliverable_id) references public.deliverables(workspace_id, id) on delete cascade
);
create index deliverable_versions_deliv_idx on public.deliverable_versions (deliverable_id, version_number desc);

alter table public.deliverables
  add constraint deliverables_current_version_fk
  foreign key (id, current_version_id) references public.deliverable_versions(deliverable_id, id)
  deferrable initially deferred;

-- A version may carry several files (carousel slides).
create table public.deliverable_version_assets (
  workspace_id  uuid not null,
  version_id    uuid not null,
  asset_id      uuid not null,
  position      smallint not null default 0,
  primary key (version_id, asset_id),
  foreign key (workspace_id, version_id) references public.deliverable_versions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, asset_id)   references public.file_assets(workspace_id, id) on delete restrict
);
create index dva_asset_idx on public.deliverable_version_assets (asset_id);

-- -----------------------------------------------------------------------------
-- Tasks & dependencies
-- -----------------------------------------------------------------------------
create table public.tasks (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null,
  client_id            uuid not null,
  content_id           uuid,
  deliverable_id       uuid,
  step_key             text,
  kind                 public.task_kind not null default 'general',
  title                text not null check (char_length(title) between 1 and 200),
  description          text,
  required_role_key    text,
  assignee_id          uuid references auth.users(id) on delete set null,
  due_at               timestamptz,
  priority             public.priority_level not null default 'medium',
  status               public.task_status not null default 'pending',
  checklist            jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  revision_request_id  uuid,
  reopen_count         integer not null default 0,
  started_at           timestamptz,
  completed_at         timestamptz,
  completed_by         uuid references auth.users(id) on delete set null,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, client_id)  references public.clients(workspace_id, id) on delete cascade,
  foreign key (workspace_id, content_id) references public.content_items(workspace_id, id) on delete cascade,
  foreign key (content_id, deliverable_id) references public.deliverables(content_id, id) on delete set null (deliverable_id),
  check (status <> 'done' or completed_at is not null)
);
create index tasks_assignee_idx on public.tasks (assignee_id, status) where status not in ('done', 'cancelled');
create index tasks_ws_status_idx on public.tasks (workspace_id, status);
create index tasks_content_idx  on public.tasks (content_id);
create index tasks_due_idx      on public.tasks (workspace_id, due_at) where status not in ('done', 'cancelled');
create unique index tasks_content_step_uq on public.tasks (content_id, step_key) where step_key is not null and kind <> 'adjustment';
create trigger tasks_touch before update on public.tasks
  for each row execute function private.touch_updated_at();

create table public.task_dependencies (
  workspace_id        uuid not null,
  task_id             uuid not null,
  depends_on_task_id  uuid not null,
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id),
  foreign key (workspace_id, task_id)            references public.tasks(workspace_id, id) on delete cascade,
  foreign key (workspace_id, depends_on_task_id) references public.tasks(workspace_id, id) on delete cascade
);
create index task_dependencies_dep_idx on public.task_dependencies (depends_on_task_id);

-- -----------------------------------------------------------------------------
-- Internal comments
-- -----------------------------------------------------------------------------
create table public.comments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  content_id    uuid not null,
  task_id       uuid,
  version_id    uuid,
  author_id     uuid references auth.users(id) on delete set null,
  body          text not null check (char_length(body) between 1 and 5000),
  created_at    timestamptz not null default now(),
  edited_at     timestamptz,
  foreign key (workspace_id, content_id) references public.content_items(workspace_id, id) on delete cascade,
  foreign key (workspace_id, task_id)    references public.tasks(workspace_id, id) on delete cascade,
  foreign key (workspace_id, version_id) references public.deliverable_versions(workspace_id, id) on delete cascade
);
create index comments_content_idx on public.comments (content_id, created_at);
