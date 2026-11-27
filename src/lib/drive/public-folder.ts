import "server-only";

/**
 * Reads a Google Drive folder shared as "Anyone with the link" without OAuth or an API key,
 * through Drive's public embedded folder view. Unofficial HTML: parsing is defensive and the
 * caller falls back to the workspace's Drive connection when nothing comes back.
 * Only drive.google.com is ever fetched, with ids validated by the regex below (no SSRF).
 */
export const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;

export interface PublicDriveEntry { id: string; name: string; mime: string | null; folder: boolean }

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|mpe?g|3gp|wmv)$/i;

export function looksLikeVideo(name: string, mime: string | null) {
  if (mime) return mime.startsWith("video/");
  return VIDEO_EXT.test(name);
}

function decode(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .trim();
}

async function getHtml(url: string) {
  const res = await fetch(url, { headers: { "accept-language": "pt-BR,pt;q=0.9" }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!res.ok) return null;
  return res.text();
}

/** Files (and subfolders) directly inside a public folder; null when Google refuses (private folder, wrong id). */
export async function listPublicFolder(folderId: string): Promise<PublicDriveEntry[] | null> {
  if (!DRIVE_ID.test(folderId)) return null;
  let html: string | null;
  try { html = await getHtml(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`); } catch { return null; }
  if (!html) return null;

  return parseFolderHtml(html, folderId);
}

/** Name of a single shared file, read from its public page title ("Nome.mp4 - Google Drive"). */
export async function publicFileName(fileId: string): Promise<string | null> {
  if (!DRIVE_ID.test(fileId)) return null;
  try {
    const html = await getHtml(`https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`);
    const t = html?.match(/<title>([^<]*)<\/title>/)?.[1];
    if (!t) return null;
    const name = decode(t).replace(/\s*-\s*Google Drive\s*$/i, "");
    return name && !/^(google drive|sign in|fazer login)/i.test(name) ? name : null;
  } catch {
    return null;
  }
}

/** Pure parser of the embedded folder view (exported for tests). */
export function parseFolderHtml(html: string, folderId: string): PublicDriveEntry[] {
  const out = new Map<string, PublicDriveEntry>();
  for (const chunk of html.split(/id="entry-/).slice(1)) {
    const id = chunk.match(/^([A-Za-z0-9_-]+)"/)?.[1];
    if (!id || !DRIVE_ID.test(id) || id === folderId || out.has(id)) continue;
    const name = decode(chunk.match(/flip-entry-title"?[^>]*>([^<]*)</)?.[1] ?? "");
    const folder = /\/folders\//.test(chunk.slice(0, 600)) || /type\/application\/vnd\.google-apps\.folder/.test(chunk);
    const mime = chunk.match(/\/type\/([a-z]+\/[A-Za-z0-9.+-]+)/)?.[1] ?? null;
    out.set(id, { id, name, mime: folder ? "application/vnd.google-apps.folder" : mime, folder });
  }
  if (!out.size) {
    // Layout changed: keep whatever file links the page has.
    for (const m of html.matchAll(/\/file\/d\/([A-Za-z0-9_-]{10,200})/g)) {
      if (!out.has(m[1])) out.set(m[1], { id: m[1], name: "", mime: null, folder: false });
    }
  }
  return [...out.values()];
}
