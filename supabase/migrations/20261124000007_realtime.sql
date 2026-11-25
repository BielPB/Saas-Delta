-- =============================================================================
-- Delta Flow — 0007 Realtime
-- Postgres Changes respect RLS, so members only receive rows they can read.
-- Guarded so the migration also runs on plain PostgreSQL (test suite).
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
    alter publication supabase_realtime add table public.content_items;
    alter publication supabase_realtime add table public.tasks;
  end if;
end $$;
