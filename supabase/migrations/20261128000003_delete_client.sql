-- Keep immutable versions and audit history while removing deleted clients from the CRM.
alter table public.clients add column deleted_at timestamptz;
create policy clients_not_deleted on public.clients as restrictive for select to authenticated using (deleted_at is null);

create function public.delete_client(p_ws uuid, p_client uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_perm(p_ws, 'clients.manage');
  if not private.can_access_client(p_ws,p_client) then perform private.fail('permission_denied','client'); end if;
  update public.clients set status = 'archived', archived_at = now(), deleted_at = now()
    where workspace_id = p_ws and id = p_client and deleted_at is null;
  if not found then perform private.fail('not_found','client'); end if;
  update public.content_items set archived_at = now() where client_id = p_client and archived_at is null;
  update public.approval_links l set revoked_at = now(), revoked_by = auth.uid()
    from public.approval_batches b where b.id = l.batch_id and b.client_id = p_client and l.revoked_at is null;
  perform private.audit(p_ws,'client.deleted','client',p_client);
end $$;
revoke all on function public.delete_client(uuid,uuid) from public, anon;
grant execute on function public.delete_client(uuid,uuid) to authenticated;

create function private.client_deleted(p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clients where id = p_client and deleted_at is not null)
$$;
revoke all on function private.client_deleted(uuid) from public, anon;
grant execute on function private.client_deleted(uuid) to authenticated;

create policy contents_live_client on public.content_items as restrictive for select to authenticated using (not private.client_deleted(client_id));
create policy tasks_live_client on public.tasks as restrictive for select to authenticated using (not private.client_deleted(client_id));
create policy files_live_client on public.file_assets as restrictive for select to authenticated using (not private.client_deleted(client_id));
create policy batches_live_client on public.approval_batches as restrictive for select to authenticated using (not private.client_deleted(client_id));

create or replace function private.can_access_client(p_ws uuid, p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_member(p_ws) and not private.client_deleted(p_client) and (
    private.has_perm(p_ws, 'clients.view_all')
    or exists (select 1 from public.client_members cm
                where cm.client_id = p_client and cm.workspace_id = p_ws and cm.user_id = (select auth.uid()))
  )
$$;
