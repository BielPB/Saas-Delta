/**
 * Turns a pasted link into something we can show inline.
 * Videos stay hosted on Google Drive (Supabase free plan caps uploads at 50 MB);
 * the portal embeds Drive's own player, which only plays when the file is shared
 * as "Anyone with the link".
 */
export type MediaLink =
  | { kind: "drive"; id: string; embed: string; open: string }
  | { kind: "drive-folder"; open: string }
  | { kind: "youtube"; id: string; embed: string; open: string }
  | { kind: "vimeo"; id: string; embed: string; open: string }
  | { kind: "other"; open: string };

const ID = /^[A-Za-z0-9_-]{10,200}$/;

export function parseMediaLink(raw: string | null | undefined): MediaLink | null {
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\./, "");
  const open = u.toString();

  if (host === "drive.google.com" || host === "docs.google.com") {
    if (/\/folders\//.test(u.pathname)) return { kind: "drive-folder", open };
    const id = u.pathname.match(/\/(?:file\/)?d\/([A-Za-z0-9_-]+)/)?.[1] ?? u.searchParams.get("id") ?? "";
    if (ID.test(id)) return { kind: "drive", id, embed: `https://drive.google.com/file/d/${id}/preview`, open: `https://drive.google.com/file/d/${id}/view` };
    return { kind: "other", open };
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    const id = host === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v") ?? u.pathname.match(/\/(?:shorts|embed)\/([A-Za-z0-9_-]+)/)?.[1] ?? "";
    if (/^[A-Za-z0-9_-]{6,20}$/.test(id)) return { kind: "youtube", id, embed: `https://www.youtube-nocookie.com/embed/${id}`, open };
  }
  if (host === "vimeo.com") {
    const id = u.pathname.match(/^\/(\d+)/)?.[1];
    if (id) return { kind: "vimeo", id, embed: `https://player.vimeo.com/video/${id}`, open };
  }
  return { kind: "other", open };
}

/**
 * Still image for a pasted video link, for cards and feed tiles.
 * Drive serves it only for files shared as "Anyone with the link" (same rule as the player);
 * callers must hide the <img> on error.
 */
export function linkThumbnail(raw: string | null | undefined): string | null {
  const l = parseMediaLink(raw);
  if (!l) return null;
  if (l.kind === "drive") return `https://drive.google.com/thumbnail?id=${encodeURIComponent(l.id)}&sz=w800`;
  if (l.kind === "youtube") return `https://i.ytimg.com/vi/${encodeURIComponent(l.id)}/hqdefault.jpg`;
  return null;
}
