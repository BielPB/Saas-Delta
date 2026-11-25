import "server-only";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "./crypto";

/**
 * Minimum scopes: read-only Drive (needed to see files that already exist in
 * the agency's folders) + identity. The app never writes, moves, deletes or
 * changes sharing of the original files.
 */
export const DRIVE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.readonly"];
const FOLDER = "application/vnd.google-apps.folder";

export function authUrl(state: string, redirectUri: string) {
  const p = new URLSearchParams({
    client_id: serverEnv().googleClientId, redirect_uri: redirectUri, response_type: "code",
    scope: DRIVE_SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function exchangeCode(code: string, redirectUri: string) {
  const e = serverEnv();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: e.googleClientId, client_secret: e.googleClientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!res.ok) throw new Error(`google_token_${res.status}`);
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope: string; id_token?: string };
}

export async function userInfo(accessToken: string) {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`google_userinfo_${res.status}`);
  return (await res.json()) as { sub: string; email: string };
}

/** Returns a valid access token for a connection, refreshing (and re-encrypting) when needed. */
export async function accessTokenFor(connectionId: string) {
  const admin = createAdminClient();
  const { data: cred } = await admin.from("drive_credentials").select("*").eq("connection_id", connectionId).single();
  if (!cred) throw new Error("drive_not_connected");
  if (cred.access_token_encrypted && cred.access_token_expires_at && new Date(cred.access_token_expires_at).getTime() > Date.now() + 60_000) {
    return decrypt(cred.access_token_encrypted);
  }
  const e = serverEnv();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: e.googleClientId, client_secret: e.googleClientSecret, refresh_token: decrypt(cred.refresh_token_encrypted), grant_type: "refresh_token" }),
  });
  if (!res.ok) {
    await admin.from("drive_connections").update({ status: "error", last_error: `refresh_${res.status}` }).eq("id", connectionId);
    throw new Error(res.status === 400 ? "drive_revoked" : `drive_refresh_${res.status}`);
  }
  const t = (await res.json()) as { access_token: string; expires_in: number };
  await admin.from("drive_credentials").update({
    access_token_encrypted: encrypt(t.access_token), access_token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), updated_at: new Date().toISOString(),
  }).eq("connection_id", connectionId);
  return t.access_token;
}

export interface DriveFile {
  id: string; name: string; mimeType: string; size?: string; createdTime?: string; modifiedTime?: string;
  thumbnailLink?: string; trashed?: boolean; parents?: string[];
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
  imageMediaMetadata?: { width?: number; height?: number };
}

/** Drive API GET with exponential backoff on rate limits (403 userRateLimitExceeded / 429) and 5xx. */
async function driveGet<T>(token: string, path: string, params: Record<string, string>): Promise<T> {
  const url = `https://www.googleapis.com/drive/v3/${path}?${new URLSearchParams(params)}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (res.ok) return (await res.json()) as T;
    const retry = res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimit/i.test(await res.clone().text()));
    if (!retry) throw new Error(`drive_api_${res.status}`);
    await new Promise((r) => setTimeout(r, Math.min(16000, 500 * 2 ** attempt) + Math.random() * 250));
  }
  throw new Error("drive_rate_limited");
}

const FIELDS = "nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, thumbnailLink, trashed, parents, videoMediaMetadata(width,height,durationMillis), imageMediaMetadata(width,height))";

export async function listChildren(token: string, folderId: string, onlyFolders = false) {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  const safe = folderId.replace(/[^a-zA-Z0-9_-]/g, "");
  do {
    const r = await driveGet<{ files: DriveFile[]; nextPageToken?: string }>(token, "files", {
      q: `'${safe}' in parents and trashed = false${onlyFolders ? ` and mimeType = '${FOLDER}'` : ""}`,
      fields: FIELDS, pageSize: "200", supportsAllDrives: "true", includeItemsFromAllDrives: "true", orderBy: "folder,name",
      ...(pageToken ? { pageToken } : {}),
    });
    out.push(...r.files);
    pageToken = r.nextPageToken;
  } while (pageToken && out.length < 5000);
  return out;
}

/** Files inside a mapped folder, walking subfolders (e.g. Fotona → Novembro → Vídeos editados) up to `depth`. */
export async function listFilesDeep(token: string, folderId: string, depth = 3, path: string[] = []): Promise<Array<DriveFile & { path: string[] }>> {
  const children = await listChildren(token, folderId);
  const files: Array<DriveFile & { path: string[] }> = [];
  for (const f of children) {
    if (f.mimeType === FOLDER) {
      if (depth > 0) files.push(...(await listFilesDeep(token, f.id, depth - 1, [...path, f.name])));
    } else if (!f.mimeType.startsWith("application/vnd.google-apps.")) {
      files.push({ ...f, path });
    }
  }
  return files;
}

export async function getFile(token: string, id: string) {
  return driveGet<DriveFile>(token, `files/${encodeURIComponent(id)}`, { fields: "id, name, mimeType, size, trashed, modifiedTime", supportsAllDrives: "true" });
}

export function categoryFor(mime: string, path: string[], fallback: string | null) {
  const p = path.join("/").toLowerCase();
  if (fallback) return fallback;
  if (/bruto|raw/.test(p)) return "raw";
  if (/capa|cover|thumb/.test(p)) return "cover";
  if (/carrossel|carousel/.test(p)) return "carousel";
  if (mime.startsWith("video/")) return /editad|final/.test(p) ? "edited_video" : "raw";
  if (mime.startsWith("image/")) return "image";
  return "document";
}
