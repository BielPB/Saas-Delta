-- =============================================================================
-- Delta Flow — 0011 Background job queue (outbox) primitives, service role only.
-- Multiple workers can run safely: claiming uses FOR UPDATE SKIP LOCKED.
-- =============================================================================
create or replace function public.claim_background_jobs(p_types text[], p_limit integer default 5)
returns setof public.background_jobs language sql security definer set search_path = '' as $$
  update public.background_jobs j
     set status = 'running', locked_at = now(), attempts = j.attempts + 1
   where j.id in (
     select id from public.background_jobs
      where status in ('queued', 'failed') and run_after <= now() and attempts < max_attempts and type = any(p_types)
      order by run_after
      limit greatest(1, least(p_limit, 50))
      for update skip locked)
  returning j.*;
$$;

create or replace function public.finish_background_job(p_id uuid, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update public.background_jobs
     set status = case when p_ok then 'done' when attempts >= max_attempts then 'dead' else 'failed' end,
         finished_at = case when p_ok then now() end,
         last_error = left(p_error, 2000),
         -- Exponential backoff: 1, 2, 4, 8… minutes.
         run_after = case when p_ok then run_after else now() + make_interval(mins => power(2, greatest(attempts - 1, 0))::int) end,
         locked_at = null
   where id = p_id;
$$;

-- Jobs stuck in "running" (worker crashed) become claimable again after 15 minutes.
create or replace function public.release_stale_jobs()
returns integer language sql security definer set search_path = '' as $$
  with r as (update public.background_jobs set status = 'failed', locked_at = null, last_error = 'stale lock released'
              where status = 'running' and locked_at < now() - interval '15 minutes' returning 1)
  select count(*)::int from r;
$$;

revoke all on function public.claim_background_jobs(text[], integer) from public, anon, authenticated;
revoke all on function public.finish_background_job(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.release_stale_jobs() from public, anon, authenticated;
grant execute on function public.claim_background_jobs(text[], integer) to service_role;
grant execute on function public.finish_background_job(uuid, boolean, text) to service_role;
grant execute on function public.release_stale_jobs() to service_role;
