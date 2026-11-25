"use server";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/utils";
import { onboardingOf, profileFields, type OnboardingItem } from "@/lib/client-sheet";

export async function saveOnboarding(clientId: string, items: OnboardingItem[]): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isUuid(clientId)) return fail("Cliente inválido.");
  const list = onboardingOf(items.slice(0, 30));
  const sb = await createClient();
  const { error } = await sb.from("clients").update({ onboarding: list }).eq("id", clientId).eq("workspace_id", ctx.workspace.id);
  if (error) return fail(error);
  revalidatePath(`/app/clientes/${clientId}`);
  return { ok: true };
}

export async function saveProfile(clientId: string, values: Record<string, string>): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isUuid(clientId)) return fail("Cliente inválido.");
  const profile = Object.fromEntries(profileFields.map((f) => [f.key, String(values[f.key] ?? "").slice(0, 5000)]));
  const sb = await createClient();
  const { error } = await sb.from("clients").update({ profile }).eq("id", clientId).eq("workspace_id", ctx.workspace.id);
  if (error) return fail(error);
  revalidatePath(`/app/clientes/${clientId}`);
  return { ok: true, message: "Ficha salva." };
}

/**
 * "Duplicar mês": copies the month's posts to the next month as fresh posts
 * (same title, format, subdivision and briefing; date +1 month; no files, status Roteiro).
 */
export async function duplicateMonth(clientId: string, ym: string): Promise<ActionResult<{ count: number; target: string }>> {
  const ctx = await getContext();
  if (!isUuid(clientId) || !/^\d{4}-\d{2}$/.test(ym)) return fail("Seleção inválida.");
  const sb = await createClient();
  const next = (() => { const d = new Date(`${ym}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7); })();
  const m0 = `${ym}-01T00:00:00Z`; const m1 = `${next}-01T00:00:00Z`;
  const { data, error } = await sb.from("content_items").select("title, format_id, service_id, briefing, objective, channel, planned_publish_at, created_at")
    .eq("workspace_id", ctx.workspace.id).eq("client_id", clientId).is("archived_at", null).neq("publication_status", "cancelled")
    .or(`and(planned_publish_at.gte.${m0},planned_publish_at.lt.${m1}),and(planned_publish_at.is.null,created_at.gte.${m0},created_at.lt.${m1})`)
    .order("planned_publish_at", { ascending: true, nullsFirst: false }).limit(200);
  if (error) return fail(error);
  const rows = (data ?? []) as Array<{ title: string; format_id: string; service_id: string | null; briefing: string | null; objective: string | null; channel: string | null; planned_publish_at: string | null }>;
  if (!rows.length) return fail("Não há posts neste mês para duplicar.");
  const plusMonth = (iso: string) => {
    const d = new Date(iso);
    const day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last)); // 31/jan → 28/fev
    return d.toISOString();
  };
  let count = 0;
  for (const r of rows) {
    const { error: e } = await sb.rpc("create_content", {
      p_ws: ctx.workspace.id, p_client: clientId, p_format: r.format_id, p_title: r.title,
      p_fields: { service_id: r.service_id ?? "", briefing: r.briefing, objective: r.objective, channel: r.channel,
        planned_publish_at: r.planned_publish_at ? plusMonth(r.planned_publish_at) : `${next}-01T12:00:00Z` },
      p_assignees: {},
    });
    if (e) return fail(count ? `${count} post(s) duplicados, mas o restante falhou. Confira o mês seguinte antes de tentar de novo.` : e);
    count++;
  }
  revalidatePath(`/app/clientes/${clientId}`);
  return { ok: true, data: { count, target: next }, message: `${count} post(s) copiados para o mês seguinte.` };
}

/** Client photo/logo: the file was uploaded by the browser under <workspace>/<client>/brand/. */
export async function setClientLogo(clientId: string, path: string | null): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isUuid(clientId)) return fail("Cliente inválido.");
  if (path !== null && !new RegExp(`^${ctx.workspace.id}/${clientId}/brand/[0-9a-f-]{36}\\.(png|jpe?g|webp)$`).test(path)) return fail("Arquivo inválido.");
  const sb = await createClient();
  const { error } = await sb.from("clients").update({ logo_path: path }).eq("id", clientId).eq("workspace_id", ctx.workspace.id);
  if (error) return fail(error);
  revalidatePath("/app", "layout");
  return { ok: true, message: path ? "Foto atualizada." : "Foto removida." };
}

/**
 * "Baixar em alta qualidade": original files (not previews) of the month's posts,
 * as short-lived signed URLs, plus captions and Drive links as text. The browser builds the ZIP.
 */
export async function monthDownloads(clientId: string, ym: string): Promise<ActionResult<{
  files: Array<{ path: string; url: string }>; texts: Array<{ path: string; content: string }>;
}>> {
  const ctx = await getContext();
  if (!isUuid(clientId) || !/^\d{4}-\d{2}$/.test(ym)) return fail("Seleção inválida.");
  const sb = await createClient();
  const next = (() => { const d = new Date(`${ym}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7); })();
  const m0 = `${ym}-01T00:00:00Z`; const m1 = `${next}-01T00:00:00Z`;
  const { data: posts, error } = await sb.from("content_items").select("id, title, planned_publish_at")
    .eq("workspace_id", ctx.workspace.id).eq("client_id", clientId).is("archived_at", null).neq("publication_status", "cancelled")
    .or(`and(planned_publish_at.gte.${m0},planned_publish_at.lt.${m1}),and(planned_publish_at.is.null,created_at.gte.${m0},created_at.lt.${m1})`)
    .order("planned_publish_at", { ascending: true, nullsFirst: false }).limit(200);
  if (error) return fail(error);
  const list = (posts ?? []) as Array<{ id: string; title: string; planned_publish_at: string | null }>;
  if (!list.length) return fail("Não há posts neste mês.");

  const { data: dels } = await sb.from("deliverables")
    .select("content_id, kind, title, current_version_id, deliverable_versions!deliverables_current_version_fk(text_content, external_url, deliverable_version_assets(position, file_assets(name, storage_path, mime_type)))")
    .in("content_id", list.map((p) => p.id)).not("current_version_id", "is", null).neq("kind", "raw_footage");
  type D = { content_id: string; kind: string; title: string; deliverable_versions: { text_content: string | null; external_url: string | null; deliverable_version_assets: Array<{ position: number; file_assets: { name: string; storage_path: string | null; mime_type: string | null } | null }> } | null };
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "sem título";
  const folders = new Map(list.map((p, i) => [p.id, `${String(i + 1).padStart(2, "0")} - ${safe(p.title)}`]));

  const wanted: Array<{ path: string; storage: string }> = [];
  const texts: Array<{ path: string; content: string }> = [];
  const links: string[] = [];
  for (const d of (dels ?? []) as unknown as D[]) {
    const folder = folders.get(d.content_id)!;
    const v = d.deliverable_versions;
    if (!v) continue;
    if (v.text_content) texts.push({ path: `${folder}/${safe(d.title).toLowerCase()}.txt`, content: v.text_content });
    if (v.external_url) links.push(`${folder} · ${d.title}: ${v.external_url}`);
    [...v.deliverable_version_assets].sort((a, b) => a.position - b.position).forEach((a, i, all) => {
      if (!a.file_assets?.storage_path) return;
      const ext = a.file_assets.name.includes(".") ? a.file_assets.name.split(".").pop()!.toLowerCase().slice(0, 5) : "bin";
      wanted.push({ path: `${folder}/${safe(d.title).toLowerCase()}${all.length > 1 ? `-${i + 1}` : ""}.${ext}`, storage: a.file_assets.storage_path });
    });
  }
  if (links.length) texts.push({ path: "links-do-drive.txt", content: `Arquivos hospedados no Google Drive (não entram no ZIP):\n\n${links.join("\n")}\n` });
  if (!wanted.length && !texts.length) return fail("Os posts deste mês ainda não têm arquivos.");
  const { data: signed } = wanted.length ? await sb.storage.from("workspace-files").createSignedUrls(wanted.map((w) => w.storage), 900) : { data: [] };
  const byPath = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path as string, s.signedUrl as string]));
  return { ok: true, data: { files: wanted.filter((w) => byPath.has(w.storage)).map((w) => ({ path: w.path, url: byPath.get(w.storage)! })), texts } };
}
