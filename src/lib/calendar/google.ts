import "server-only";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "@/lib/drive/crypto";

/**
 * Smallest scope that reads and writes events: no access to calendar settings,
 * sharing or other people's calendars. "Sensitive" for Google: without app
 * verification people see an "unverified app" screen (max 100 test users).
 */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_SCOPES = ["openid", "email", CALENDAR_SCOPE];

export function calendarAuthUrl(state: string, redirectUri: string) {
  const p = new URLSearchParams({
    client_id: serverEnv().googleClientId, redirect_uri: redirectUri, response_type: "code",
    scope: CALENDAR_SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function calendarToken(connectionId: string) {
  const admin = createAdminClient();
  const { data: cred } = await admin.from("calendar_credentials").select("*").eq("connection_id", connectionId).single();
  if (!cred) throw new Error("calendar_not_connected");
  if (cred.access_token_encrypted && cred.access_token_expires_at && new Date(cred.access_token_expires_at).getTime() > Date.now() + 60_000) {
    return decrypt(cred.access_token_encrypted);
  }
  const e = serverEnv();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: e.googleClientId, client_secret: e.googleClientSecret, refresh_token: decrypt(cred.refresh_token_encrypted), grant_type: "refresh_token" }),
  });
  if (!res.ok) {
    await admin.from("calendar_connections").update({ status: "error", last_error: res.status === 400 ? "Acesso revogado ou expirado. Conecte de novo." : `Falha ao renovar (${res.status}).` }).eq("id", connectionId);
    throw new Error("calendar_refresh");
  }
  const t = (await res.json()) as { access_token: string; expires_in: number };
  await admin.from("calendar_credentials").update({
    access_token_encrypted: encrypt(t.access_token), access_token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), updated_at: new Date().toISOString(),
  }).eq("connection_id", connectionId);
  return t.access_token;
}

export interface GEvent {
  id: string; description?: string; location?: string; summary?: string; status?: string; visibility?: string; htmlLink?: string;
  start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string };
}

const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

async function call(token: string, url: string, init: RequestInit = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
    if (res.status !== 429 && res.status < 500) return res;
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
  throw new Error("calendar_rate_limited");
}

export async function listEvents(token: string, timeMin: string, timeMax: string): Promise<GEvent[]> {
  const p = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "150" });
  const res = await call(token, `${BASE}?${p}`);
  if (!res.ok) throw new Error(`calendar_list_${res.status}`);
  return ((await res.json()) as { items?: GEvent[] }).items?.filter((e) => e.status !== "cancelled") ?? [];
}

export interface EventBody { summary: string; description: string; start: { dateTime: string }; end: { dateTime: string } }

/** Updates the event we created before; recreates it if the person deleted it in Google. */
export async function upsertEvent(token: string, existingId: string | null, body: EventBody): Promise<string> {
  const payload = { ...body, source: { title: "Delta Flow", url: body.description.split("\n").pop() }, reminders: { useDefault: true } };
  if (existingId) {
    const res = await call(token, `${BASE}/${encodeURIComponent(existingId)}`, { method: "PATCH", body: JSON.stringify(payload) });
    if (res.ok) return ((await res.json()) as { id: string }).id;
    if (res.status !== 404 && res.status !== 410) throw new Error(`calendar_patch_${res.status}`);
  }
  const res = await call(token, BASE, { method: "POST", body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`calendar_insert_${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

export async function deleteEvent(token: string, id: string) {
  const res = await call(token, `${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`calendar_delete_${res.status}`);
}

export async function revokeToken(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
}
