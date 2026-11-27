"use server";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/errors";
import { fromLocalInput } from "@/lib/format";
import { isUuid } from "@/lib/utils";
import { parseMediaLink } from "@/lib/media-link";
import { accessTokenFor, listChildren } from "@/lib/drive/google";
import { DRIVE_ID, listPublicFolder, looksLikeVideo, publicFileName } from "@/lib/drive/public-folder";

export interface LinkedVideo { url: string; name: string }

const MAX_ITEMS = 60;
const FOLDER_MIME = "application/vnd.google-apps.folder";
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "pt-BR", { numeric: true, sensitivity: "base" });
const fileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

/** Videos of a folder: public view first; then the workspace's Drive connection (folders not shared publicly). */
async function folderVideos(folderId: string): Promise<{ videos: LinkedVideo[]; skipped: number; subfolders: number } | null> {
  const pub = await listPublicFolder(folderId);
  if (pub && pub.some((e) => !e.folder)) {
    const files = pub.filter((e) => !e.folder);
    const unknown = files.every((f) => !f.name && !f.mime); // fallback parse: no names, keep every file
    const videos = files.filter((f) => unknown || looksLikeVideo(f.name, f.mime));
    return {
      videos: videos.map((f, i) => ({ url: fileUrl(f.id), name: f.name || `Vídeo ${i + 1}` })).sort(byName),
      skipped: files.length - videos.length, subfolders: pub.length - files.length,
    };
  }

  // Not public (or Google changed the page): try the agency's connected Drive. RLS decides whether
  // this person may see the connection before the service-role token is used.
  const ctx = await getContext();
  const sb = await createClient();
  const { data: conn } = await sb.from("drive_connections").select("id").eq("workspace_id", ctx.workspace.id).eq("status", "active").limit(1).maybeSingle();
  if (!conn) return pub ? { videos: [], skipped: 0, subfolders: pub.length } : null;
  try {
    const token = await accessTokenFor(conn.id as string);
    const children = await listChildren(token, folderId);
    const files = children.filter((f) => f.mimeType !== FOLDER_MIME);
    const videos = files.filter((f) => f.mimeType.startsWith("video/"));
    return {
      videos: videos.map((f) => ({ url: fileUrl(f.id), name: f.name })).sort(byName),
      skipped: files.length - videos.length, subfolders: children.length - files.length,
    };
  } catch {
    return pub ? { videos: [], skipped: 0, subfolders: pub.length } : null;
  }
}

/**
 * Step 1 of "Vários vídeos por link": reads what was pasted (a Drive folder, or several video links)
 * and returns the videos found. Nothing is created yet.
 */
export async function scanVideoLinks(clientId: string, text: string): Promise<ActionResult<{ videos: LinkedVideo[]; note: string | null }>> {
  await getContext();
  if (!isUuid(clientId)) return fail("Cliente inválido.");
  const urls = [...new Set((text.match(/https?:\/\/[^\s<>"']+/g) ?? []).map((u) => u.replace(/[),.;]+$/, "")))].slice(0, MAX_ITEMS);
  if (!urls.length) return fail("Cole o link da pasta do Google Drive (ou os links dos vídeos, um por linha).");

  const videos: LinkedVideo[] = [];
  const notes: string[] = [];
  let skipped = 0, subfolders = 0;
  const singles: Array<{ id: string | null; url: string }> = [];

  for (const raw of urls) {
    const link = parseMediaLink(raw);
    if (!link) { notes.push("Links precisam começar com https://."); continue; }
    if (link.kind === "drive-folder") {
      const folderId = new URL(link.open).pathname.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] ?? "";
      if (!DRIVE_ID.test(folderId)) { notes.push("Não reconheci um dos links de pasta."); continue; }
      const r = await folderVideos(folderId);
      if (!r) {
        return fail("Não consegui abrir a pasta. No Drive, clique com o botão direito na pasta → Compartilhar → em “Acesso geral”, escolha “Qualquer pessoa com o link” e tente de novo.");
      }
      videos.push(...r.videos);
      skipped += r.skipped; subfolders += r.subfolders;
    } else if (link.kind === "drive") {
      singles.push({ id: link.id, url: link.open });
    } else if (link.kind === "youtube" || link.kind === "vimeo") {
      singles.push({ id: null, url: link.open });
    } else {
      notes.push("Alguns links não são do Google Drive, YouTube ou Vimeo e foram ignorados.");
    }
  }

  const names = await Promise.all(singles.map((s) => (s.id ? publicFileName(s.id) : Promise.resolve(null))));
  singles.forEach((s, i) => videos.push({ url: s.url, name: names[i] ?? `Vídeo ${videos.length + 1}` }));

  const unique = [...new Map(videos.map((v) => [v.url, v])).values()].slice(0, MAX_ITEMS);
  if (skipped) notes.push(`${skipped} arquivo(s) que não são vídeo ficaram de fora.`);
  if (subfolders) notes.push(`${subfolders} subpasta(s) foram ignoradas: cole o link de cada uma se quiser os vídeos delas.`);
  if (!unique.length) return fail(notes.length ? `Nenhum vídeo encontrado. ${[...new Set(notes)].join(" ")}` : "Nenhum vídeo encontrado nesse link.");
  return { ok: true, data: { videos: unique, note: notes.length ? [...new Set(notes)].join(" ") : null } };
}

/**
 * Step 2: one post per video, same path as "Novo reels" (create_content), with the Drive link
 * already sent as the video. Partial success is reported; nothing is rolled back.
 */
export async function createPostsFromLinks(input: {
  clientId: string; formatId: string; plannedAt: string | null;
  items: Array<{ url: string; title: string; serviceId: string | null }>;
}): Promise<ActionResult<{ created: number }>> {
  const ctx = await getContext();
  if (!isUuid(input.clientId) || !isUuid(input.formatId)) return fail("Escolha o formato.");
  const items = input.items.slice(0, MAX_ITEMS).filter((it) => {
    const l = parseMediaLink(it.url);
    return l && ["drive", "youtube", "vimeo"].includes(l.kind);
  });
  if (!items.length) return fail("Nenhum vídeo válido para criar.");
  const planned = input.plannedAt ? fromLocalInput(input.plannedAt, ctx.workspace.timezone) : null;
  const sb = await createClient();

  let created = 0;
  const problems: string[] = [];
  for (const [i, it] of items.entries()) {
    const title = it.title.trim().slice(0, 200) || `Vídeo ${i + 1}`;
    const { data: id, error } = await sb.rpc("create_content", {
      p_ws: ctx.workspace.id, p_client: input.clientId, p_format: input.formatId, p_title: title,
      p_fields: { service_id: it.serviceId && isUuid(it.serviceId) ? it.serviceId : "", planned_publish_at: planned },
      p_assignees: {},
    });
    if (error || !id) {
      if (!created) return fail(error ?? "Não foi possível criar os posts.");
      problems.push(`“${title}” não foi criado`);
      continue;
    }
    created++;
    const { data: dels } = await sb.from("deliverables").select("id, kind").eq("content_id", id as string).in("kind", ["video", "raw_footage"]).order("position");
    const target = (dels ?? []).find((d) => d.kind === "video") ?? dels?.[0];
    const { error: vErr } = target
      ? await sb.rpc("add_deliverable_version", { p_deliverable: target.id, p_text: null, p_asset_ids: [], p_external_url: it.url, p_reason: null })
      : { error: { message: "no_video" } };
    if (vErr) problems.push(`“${title}” foi criado sem o vídeo (cole o link no post)`);
  }

  revalidatePath(`/app/clientes/${input.clientId}`);
  revalidatePath("/app/pipeline");
  const msg = `${created} post${created === 1 ? "" : "s"} criado${created === 1 ? "" : "s"} com o vídeo.`;
  return { ok: true, data: { created }, message: problems.length ? `${msg} Atenção: ${problems.slice(0, 3).join("; ")}.` : msg };
}
