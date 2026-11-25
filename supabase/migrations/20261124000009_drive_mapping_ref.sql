-- =============================================================================
-- Delta Flow — 0009 Track which mapped Drive folder imported each reference,
-- so "missing" detection is scoped to that folder tree only.
-- =============================================================================
alter table public.file_assets add column drive_mapping_id uuid references public.drive_folder_mappings(id) on delete set null;
create index file_assets_drive_mapping_idx on public.file_assets (drive_mapping_id, last_seen_at) where drive_mapping_id is not null;
