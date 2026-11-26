import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Service-role client. BYPASSES RLS. Allowed uses only:
 *   1. Signing storage URLs for paths a validated RPC already returned.
 *   2. Reading/writing encrypted Drive credentials.
 *   3. Background jobs and cron.
 *   4. Deleting unlinked library files, only ids already read through RLS by a member with files.manage.
 *   5. Team invites (invite / resend e-mail, "Gerar acesso"), only for an invite read through RLS
 *      by a member with members.manage, and never for an account that has already signed in.
 * Never pass user-supplied ids to it without an authorization check first.
 */
export function createAdminClient() {
  const key = serverEnv().serviceRoleKey;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada.");
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
