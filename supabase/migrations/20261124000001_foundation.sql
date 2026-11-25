-- =============================================================================
-- Delta Flow — 0001 Foundation
-- Tenancy, identity, roles & permissions, settings.
--
-- Conventions
--   * Every tenant-owned row carries workspace_id.
--   * Parent tables expose UNIQUE (workspace_id, id) so children can use
--     COMPOSITE foreign keys. A child can never point at a parent that lives in
--     another workspace, even if application code has a bug.
--   * Business helpers live in schema `private` (not exposed by PostgREST).
--   * Business mutations that change state go through SECURITY DEFINER RPCs in
--     `public` that validate permissions explicitly (see 0005/0006).
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.member_status       as enum ('invited', 'active', 'disabled');
create type public.client_status       as enum ('active', 'inactive', 'archived');
create type public.priority_level      as enum ('low', 'medium', 'high', 'urgent');
create type public.production_status   as enum ('planned', 'in_production', 'internal_review', 'adjustments', 'done');
create type public.approval_status     as enum ('not_sent', 'awaiting', 'partially_approved', 'rejected', 'approved');
create type public.publication_status  as enum ('unscheduled', 'planned', 'ready', 'scheduled', 'published', 'cancelled');
create type public.deliverable_kind    as enum ('script', 'raw_footage', 'video', 'cover', 'caption', 'image', 'carousel', 'other');
create type public.version_status      as enum ('pending', 'approved', 'rejected', 'superseded');
create type public.task_status         as enum ('blocked', 'pending', 'in_progress', 'in_review', 'done', 'reopened', 'cancelled');
create type public.task_kind           as enum ('production', 'review', 'adjustment', 'general');
create type public.content_stage       as enum (
  'planning', 'script', 'capture', 'editing', 'cover', 'caption',
  'internal_review', 'client_approval', 'adjustments', 'ready', 'scheduled', 'published', 'cancelled'
);
create type public.asset_provider      as enum ('supabase', 'drive', 'external_link');
create type public.asset_status        as enum ('uploading', 'available', 'processing', 'missing', 'error');

-- -----------------------------------------------------------------------------
-- Generic triggers
-- -----------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Workspaces (tenants)
-- -----------------------------------------------------------------------------
create table public.workspaces (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 2 and 120),
  slug            text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  logo_path       text,
  brand_color     text not null default '#C6FF34' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  timezone        text not null default 'America/Fortaleza',
  locale          text not null default 'pt-BR',
  -- Billing readiness: plan + limits are read by the app, no billing in v1.
  plan            text not null default 'internal',
  limits          jsonb not null default '{}'::jsonb,
  content_counter integer not null default 0,
  onboarding      jsonb not null default '{}'::jsonb,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);
create trigger workspaces_touch before update on public.workspaces
  for each row execute function private.touch_updated_at();

create table public.workspace_settings (
  workspace_id                  uuid primary key references public.workspaces(id) on delete cascade,
  approval_default_expiry_days  integer not null default 15 check (approval_default_expiry_days between 1 and 90),
  approval_require_pin          boolean not null default false,
  approval_stale_after_days     integer not null default 3 check (approval_stale_after_days between 1 and 60),
  notify_email_enabled          boolean not null default true,
  week_starts_on                smallint not null default 0 check (week_starts_on between 0 and 6),
  data_retention_months         integer not null default 24 check (data_retention_months between 1 and 120),
  extra                         jsonb not null default '{}'::jsonb,
  updated_at                    timestamptz not null default now()
);
create trigger workspace_settings_touch before update on public.workspace_settings
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Profiles (1:1 with auth.users — credentials stay in Supabase Auth)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), ''),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Membership
-- -----------------------------------------------------------------------------
create table public.workspace_members (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete cascade,
  status         public.member_status not null default 'invited',
  invited_email  text,
  invited_by     uuid references auth.users(id) on delete set null,
  joined_at      timestamptz,
  disabled_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, user_id),
  check (user_id is not null or invited_email is not null)
);
create unique index workspace_members_invite_uq
  on public.workspace_members (workspace_id, lower(invited_email))
  where user_id is null;
create index workspace_members_user_idx on public.workspace_members (user_id) where status = 'active';
create trigger workspace_members_touch before update on public.workspace_members
  for each row execute function private.touch_updated_at();

-- Global permission catalog (not tenant-owned).
create table public.permissions (
  key          text primary key,
  resource     text not null,
  description  text not null
);

insert into public.permissions (key, resource, description) values
  ('workspace.manage',       'workspace',     'Editar dados, identidade visual e configurações do workspace'),
  ('members.manage',         'members',       'Convidar, desativar e alterar funções de colaboradores'),
  ('roles.manage',           'roles',         'Criar e editar funções e permissões'),
  ('clients.view_all',       'clients',       'Visualizar todos os clientes (sem precisar estar alocado)'),
  ('clients.manage',         'clients',       'Criar, editar, arquivar clientes e serviços'),
  ('contents.manage',        'contents',      'Criar, editar, duplicar e arquivar conteúdos'),
  ('contents.delete',        'contents',      'Excluir conteúdos definitivamente'),
  ('tasks.manage',           'tasks',         'Criar, atribuir e reabrir tarefas de qualquer colaborador'),
  ('tasks.view_all',         'tasks',         'Visualizar tarefas de toda a equipe'),
  ('files.upload',           'files',         'Enviar arquivos e versões para entregáveis atribuídos'),
  ('files.manage',           'files',         'Gerenciar a biblioteca de arquivos e vínculos'),
  ('approvals.manage',       'approvals',     'Criar, revogar links e acompanhar aprovações'),
  ('approvals.invalidate',   'approvals',     'Invalidar aprovações já concedidas, com motivo'),
  ('publications.manage',    'publications',  'Programar, reagendar e confirmar publicações'),
  ('publications.override',  'publications',  'Agendar sem aprovação (exceção auditada)'),
  ('integrations.manage',    'integrations',  'Conectar Google Drive e outras integrações'),
  ('reports.view',           'reports',       'Acessar relatórios e indicadores consolidados'),
  ('audit.view',             'audit',         'Visualizar logs de auditoria');

create table public.roles (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  key             text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  name            text not null,
  description     text,
  is_system       boolean not null default false,
  -- Deliverable kinds this role produces. Used to route adjustment tasks.
  produces_kinds  public.deliverable_kind[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, key)
);
create trigger roles_touch before update on public.roles
  for each row execute function private.touch_updated_at();

create table public.role_permissions (
  role_id         uuid not null references public.roles(id) on delete cascade,
  permission_key  text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

create table public.member_roles (
  workspace_id  uuid not null,
  member_id     uuid not null,
  role_id       uuid not null,
  created_at    timestamptz not null default now(),
  primary key (member_id, role_id),
  foreign key (workspace_id, member_id) references public.workspace_members(workspace_id, id) on delete cascade,
  foreign key (workspace_id, role_id)   references public.roles(workspace_id, id) on delete cascade
);
create index member_roles_role_idx on public.member_roles (role_id);
