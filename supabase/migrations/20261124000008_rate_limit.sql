-- =============================================================================
-- Delta Flow — 0008 Rate limiting (fixed window), service role only.
-- Used by the Next.js server in front of the public portal and auth flows.
-- Direct PostgREST calls are additionally bounded by Supabase's own limits,
-- 256-bit link tokens and per-link PIN lockout (see SECURITY.md).
-- =============================================================================
create or replace function public.rate_limit_hit(p_bucket text, p_max integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_hits integer;
begin
  insert into private.rate_limits as r (bucket, window_start, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_max;
end $$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- Housekeeping helper for cron: drop stale buckets and expired portal sessions.
create or replace function public.run_housekeeping()
returns void language sql security definer set search_path = '' as $$
  delete from private.rate_limits where window_start < now() - interval '1 day';
  delete from public.approval_link_sessions where expires_at < now();
$$;
revoke all on function public.run_housekeeping() from public, anon, authenticated;
grant execute on function public.run_housekeeping() to service_role;
