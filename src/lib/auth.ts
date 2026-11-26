import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";

export const WS_COOKIE = "df_ws";

export type Permission =
  | "workspace.manage" | "members.manage" | "roles.manage" | "clients.view_all" | "clients.manage"
  | "contents.manage" | "contents.delete" | "tasks.manage" | "tasks.view_all" | "files.upload" | "files.manage"
  | "approvals.manage" | "approvals.invalidate" | "publications.manage" | "publications.override"
  | "integrations.manage" | "reports.view" | "audit.view";

export interface WorkspaceSummary { id: string; name: string; slug: string; logo_path: string | null; brand_color: string; timezone: string }

export interface AppContext {
  user: { id: string; email: string | null };
  profile: { full_name: string; avatar_url: string | null; email: string | null };
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  memberId: string;
  permissions: Permission[];
  roles: string[];
  can: (p: Permission) => boolean;
}

/** Verified identity from the JWT (signature checked by getClaims). */
export const getUser = cache(async () => {
  if (!isConfigured()) return null;
  const sb = await createClient();
  const { data } = await sb.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) return null;
  return { id: sub, email: (data.claims.email as string | undefined) ?? null };
});

export async function requireUser() {
  const u = await getUser();
  if (!u) redirect("/entrar");
  return u;
}

/**
 * Data Access Layer entry point. Resolves the active workspace from the cookie
 * but ONLY among workspaces where the user is an active member (verified by
 * RLS). Every page and action calls this; nothing trusts client-sent ids.
 */
export const getContext = cache(async (): Promise<AppContext> => {
  const user = await requireUser();
  const sb = await createClient();
  const [{ data: memberships }, { data: profile }] = await Promise.all([
    sb.from("workspace_members")
      .select("id, workspace_id, workspaces(id, name, slug, logo_path, brand_color, timezone)")
      .eq("user_id", user.id).eq("status", "active"),
    sb.from("profiles").select("full_name, avatar_url, email").eq("id", user.id).maybeSingle(),
  ]);
  const list = (memberships ?? []).filter((m) => m.workspaces) as unknown as Array<{
    id: string; workspace_id: string; workspaces: WorkspaceSummary;
  }>;
  if (list.length === 0) {
    // Invited after creating the account (or still signed in from before): accept now, not only at sign-in.
    const { data: accepted } = await sb.rpc("accept_pending_invites");
    redirect(Number(accepted) > 0 ? "/app" : "/onboarding");
  }

  const store = await cookies();
  const wanted = store.get(WS_COOKIE)?.value;
  const current = list.find((m) => m.workspace_id === wanted) ?? list[0];

  const [{ data: perms }, { data: roleRows }] = await Promise.all([
    sb.rpc("my_permissions", { p_ws: current.workspace_id }),
    sb.from("member_roles").select("roles(key)").eq("member_id", current.id),
  ]);
  const permissions = ((perms as string[] | null) ?? []) as Permission[];
  const set = new Set(permissions);
  return {
    user,
    profile: { full_name: profile?.full_name ?? "", avatar_url: profile?.avatar_url ?? null, email: profile?.email ?? user.email },
    workspace: current.workspaces,
    workspaces: list.map((m) => m.workspaces),
    memberId: current.id,
    permissions,
    roles: ((roleRows ?? []) as unknown as Array<{ roles: { key: string } | null }>).map((r) => r.roles?.key ?? "").filter(Boolean),
    can: (p) => set.has(p),
  };
});

/** Page-level guard. The database enforces the same rule; this only avoids rendering a useless page. */
export async function requirePermission(p: Permission) {
  const ctx = await getContext();
  if (!ctx.can(p)) notFound();
  return ctx;
}
