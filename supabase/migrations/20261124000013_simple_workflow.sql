-- =============================================================================
-- Delta Flow — 0013 Simple workflow (UI v2)
--   * Client categories (sidebar folders: Social Media, Avulsos, Ex-clientes…)
--   * Manual pre-approval status per post (planning → production → review).
--     Approval / adjustments / ready / scheduled / published stay derived.
--   * Post editor (who produces the art or the video).
--   * submit_for_approval(): replaces the internal-review task for posts
--     created without a task template. Releases current versions to the
--     portal and resolves adjustment requests that already have a newer version.
-- Idempotent where practical.
-- =============================================================================

-- Client categories --------------------------------------------------------------
create table if not exists public.client_categories (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, name)
);
alter table public.client_categories enable row level security;

alter table public.clients add column if not exists category_id uuid;
do $$ begin
  alter table public.clients add constraint clients_category_fk
    foreign key (workspace_id, category_id) references public.client_categories(workspace_id, id) on delete set null (category_id);
exception when duplicate_object then null; end $$;
create index if not exists clients_category_idx on public.clients (category_id);

drop policy if exists categories_select on public.client_categories;
create policy categories_select on public.client_categories for select to authenticated
  using (private.is_member(workspace_id));
drop policy if exists categories_write on public.client_categories;
create policy categories_write on public.client_categories for all to authenticated
  using (private.has_perm(workspace_id, 'clients.manage')) with check (private.has_perm(workspace_id, 'clients.manage'));
grant select, insert, update, delete on public.client_categories to authenticated;
grant all on public.client_categories to service_role;

-- Default categories for existing workspaces; new workspaces get them from the trigger below.
insert into public.client_categories (workspace_id, name, position)
select w.id, x.name, x.pos from public.workspaces w
cross join (values ('Social Media', 0), ('Avulsos', 1), ('Ex-clientes', 2)) as x(name, pos)
on conflict (workspace_id, name) do nothing;

-- Existing clients: active ones go to "Social Media", inactive ones to "Ex-clientes".
update public.clients cl set category_id = cat.id
  from public.client_categories cat
 where cl.category_id is null and cat.workspace_id = cl.workspace_id
   and cat.name = case when cl.status = 'active' then 'Social Media' else 'Ex-clientes' end;

create or replace function private.seed_client_categories()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.client_categories (workspace_id, name, position)
  values (new.id, 'Social Media', 0), (new.id, 'Avulsos', 1), (new.id, 'Ex-clientes', 2)
  on conflict (workspace_id, name) do nothing;
  return new;
end $$;
drop trigger if exists workspaces_seed_categories on public.workspaces;
create trigger workspaces_seed_categories after insert on public.workspaces
  for each row execute function private.seed_client_categories();

-- Post status and editor ------------------------------------------------------------
alter table public.content_items add column if not exists work_status text not null default 'planning';
do $$ begin
  alter table public.content_items add constraint content_items_work_status_chk check (work_status in ('planning', 'production', 'review'));
exception when duplicate_object then null; end $$;
alter table public.content_items add column if not exists editor_id uuid references auth.users(id) on delete set null;

-- editor_id is a plain field (same rules as the other editable columns of 0004).
grant update (editor_id) on public.content_items to authenticated;

create or replace function public.set_work_status(p_content uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.content_items%rowtype;
begin
  select * into c from public.content_items where id = p_content;
  if not found or not private.can_access_content(p_content) then perform private.fail('not_found', 'content'); end if;
  if p_status not in ('planning', 'production', 'review') then perform private.fail('validation', 'status'); end if;
  if not (private.has_perm(c.workspace_id, 'contents.manage')
          or c.editor_id = auth.uid()
          or exists (select 1 from public.content_assignees a where a.content_id = p_content and a.user_id = auth.uid())) then
    perform private.fail('permission_denied', 'status');
  end if;
  if c.publication_status in ('published', 'cancelled') then perform private.fail('invalid_transition', 'content_published'); end if;
  update public.content_items set work_status = p_status where id = p_content;
  perform private.log_activity(c.workspace_id, 'content', p_content, 'content.status_set', c.client_id, p_content,
                               jsonb_build_object('status', p_status));
end $$;

create or replace function public.submit_for_approval(p_content uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.content_items%rowtype;
  r record;
  v_missing integer;
begin
  select * into c from public.content_items where id = p_content for update;
  if not found or not private.can_access_content(p_content) then perform private.fail('not_found', 'content'); end if;
  if not (private.has_perm(c.workspace_id, 'approvals.manage') or private.has_perm(c.workspace_id, 'tasks.manage')) then
    perform private.fail('permission_denied', 'submit_for_approval');
  end if;
  if c.publication_status in ('published', 'cancelled') then perform private.fail('invalid_transition', 'content_published'); end if;

  select count(*) into v_missing from public.deliverables d
   where d.content_id = p_content and d.required and d.current_version_id is null;
  if v_missing > 0 then perform private.fail('deliverable_missing', v_missing || ' entregável(is) obrigatório(s)'); end if;

  perform private.allow_state_change();

  -- Adjustment requests: resolved only when a version newer than the rejected one exists.
  for r in
    select rr.id, rr.task_id, rr.deliverable_id, v.version_number as rejected_number
      from public.revision_requests rr
      join public.deliverable_versions v on v.id = rr.version_id
     where rr.content_id = p_content and rr.status = 'open'
  loop
    if not exists (select 1 from public.deliverables d join public.deliverable_versions cv on cv.id = d.current_version_id
                    where d.id = r.deliverable_id and cv.version_number > r.rejected_number) then
      perform private.fail('adjustments_pending', 'envie uma nova versão do item reprovado');
    end if;
    update public.revision_requests set status = 'resolved', resolved_at = now() where id = r.id;
    update public.tasks set status = 'done', completed_at = now(), completed_by = auth.uid()
     where id = r.task_id and status not in ('done', 'cancelled');
  end loop;

  -- Close any open internal review task (posts created from a template).
  update public.tasks set status = 'done', completed_at = now(), completed_by = auth.uid()
   where content_id = p_content and kind = 'review' and status not in ('done', 'cancelled');

  update public.deliverable_versions v set released_at = now(), released_by = auth.uid()
    from public.deliverables d
   where d.content_id = p_content and d.client_facing and v.id = d.current_version_id and v.released_at is null;

  update public.content_items set work_status = 'review' where id = p_content;
  perform private.log_activity(c.workspace_id, 'content', p_content, 'content.submitted', c.client_id, p_content, '{}'::jsonb);
  perform private.recompute_content(p_content);
end $$;

revoke all on function public.set_work_status(uuid, text) from public, anon;
revoke all on function public.submit_for_approval(uuid) from public, anon;
grant execute on function public.set_work_status(uuid, text) to authenticated;
grant execute on function public.submit_for_approval(uuid) to authenticated;
