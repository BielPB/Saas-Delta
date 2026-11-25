import "server-only";
import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { createAnonClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

export const TOKEN_RE = /^[0-9a-f]{64}$/;

/** Cookie name is derived from the token hash, so the raw token never sits in a cookie name. */
export function sessionCookieName(token: string) {
  return `df_ps_${createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
}

export async function getPortalSession(token: string) {
  return (await cookies()).get(sessionCookieName(token))?.value ?? null;
}

export async function setPortalSession(token: string, session: string) {
  (await cookies()).set(sessionCookieName(token), session, {
    httpOnly: true, secure: true, sameSite: "lax", path: `/aprovacao/${token}`, maxAge: 60 * 60 * 12,
  });
}

/** Server-side throttle (per IP hash). Returns true when allowed. Fails open if not configured. */
export async function throttle(scope: string, max: number, windowSeconds: number) {
  if (!serverEnv().serviceRoleKey) return true;
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "0").split(",")[0].trim();
  const bucket = `${scope}:${createHash("sha256").update(ip).digest("hex").slice(0, 24)}`;
  const { data, error } = await createAdminClient().rpc("rate_limit_hit", { p_bucket: bucket, p_max: max, p_window_seconds: windowSeconds });
  return error ? true : Boolean(data);
}

export function portalRpc() {
  return createAnonClient();
}

export interface PortalAsset {
  id: string; name: string; mime_type: string | null; provider: string; bucket: string | null; path: string | null;
  preview_path: string | null; thumbnail_path: string | null; width: number | null; height: number | null; drive_file_id: string | null; status: string;
}
export interface PortalDeliverable {
  deliverable_id: string; kind: string; title: string;
  version: null | { id: string; number: number; text: string | null; external_url: string | null; status: string; created_at: string; decidable: boolean; assets: PortalAsset[] };
  decision: null | { decision: "approved" | "rejected"; comment: string | null; at: string; reviewer_name: string | null };
  history: Array<{ version: number; decision: string; comment: string | null; at: string }>;
}
export interface PortalData {
  agency: { name: string; logo_path: string | null; brand_color: string };
  client: { name: string; logo_path: string | null };
  batch: { id: string; name: string; due_at: string | null; status: string; submitted_at: string | null; expires_at: string | null };
  items: Array<{ content_id: string; code: number; title: string; objective: string | null; format: string; format_key: string; aspect_ratio: string | null;
    service: string | null; planned_publish_at: string | null; channel: string | null; deliverables: PortalDeliverable[] }>;
}

/**
 * Signs ONLY the storage paths that the validated portal_get RPC returned for
 * this link. Short TTL; private bucket; never cached publicly.
 */
export async function signPortalMedia(data: PortalData) {
  const paths = new Set<string>();
  for (const it of data.items) for (const d of it.deliverables) for (const a of d.version?.assets ?? []) {
    if (a.provider === "supabase") { const p = a.preview_path ?? a.path; if (p) paths.add(p); if (a.thumbnail_path) paths.add(a.thumbnail_path); }
  }
  if (data.agency.logo_path) paths.add(data.agency.logo_path);
  if (data.client.logo_path) paths.add(data.client.logo_path);
  if (!paths.size || !serverEnv().serviceRoleKey) return new Map<string, string>();
  const { data: signed } = await createAdminClient().storage.from("workspace-files").createSignedUrls([...paths], 60 * 60);
  return new Map((signed ?? []).filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl as string]));
}
