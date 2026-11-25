"use server";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/utils";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET } from "@/lib/data";

export interface Suggestion { content_id: string; code: number; title: string; deliverable_id: string; deliverable_kind: string; score: number; reasons: string[] }

export async function suggestionsFor(assetId: string): Promise<Suggestion[]> {
  await getContext();
  const sb = await createClient();
  const { data } = await sb.rpc("suggest_asset_links", { p_asset: assetId });
  return (data ?? []) as Suggestion[];
}

/** User-confirmed link: the asset becomes a new version of the chosen deliverable. */
export async function linkAsset(assetId: string, deliverableId: string, contentId: string): Promise<ActionResult> {
  await getContext();
  if (!isUuid(assetId) || !isUuid(deliverableId)) return fail("Seleção inválida.");
  const sb = await createClient();
  const { error } = await sb.rpc("add_deliverable_version", { p_deliverable: deliverableId, p_text: null, p_asset_ids: [assetId], p_external_url: null, p_reason: "Vinculado a partir do Drive" });
  if (error) return fail(error);
  revalidatePath("/app/arquivos");
  revalidatePath(`/app/conteudos/${contentId}`);
  return { ok: true, message: "Arquivo vinculado como nova versão." };
}

export async function archiveAsset(assetId: string): Promise<ActionResult> {
  const ctx = await getContext();
  const sb = await createClient();
  // Only the Delta Flow reference is archived; the original file is never touched.
  const { error } = await sb.from("file_assets").update({ archived_at: new Date().toISOString() }).eq("id", assetId).eq("workspace_id", ctx.workspace.id);
  if (error) return fail(error);
  revalidatePath("/app/arquivos");
  return { ok: true, message: "Referência arquivada. O arquivo original não foi alterado." };
}

/**
 * "Excluir" from the library.
 * - Files not used by any deliverable version: removed from storage and from the library for good.
 * - Files used by a version: cannot be erased (the version history and the client's approval point to
 *   them; the FK is ON DELETE RESTRICT), so they are only hidden from the library.
 * Google Drive originals are never touched: only the Delta Flow reference is removed.
 */
export async function deleteAssets(ids: string[]): Promise<ActionResult<{ deleted: number; hidden: number }>> {
  const ctx = await getContext();
  if (!ctx.can("files.manage")) return fail("Você não tem permissão para excluir arquivos.");
  const clean = [...new Set(ids.filter(isUuid))].slice(0, 200);
  if (!clean.length) return fail("Selecione ao menos um arquivo.");
  const sb = await createClient();
  // Read through RLS first: only files this member can see in this workspace go further.
  const { data, error } = await sb.from("file_assets")
    .select("id, provider, storage_bucket, storage_path, preview_path, thumbnail_path, deliverable_version_assets(version_id)")
    .eq("workspace_id", ctx.workspace.id).in("id", clean);
  if (error) return fail(error);
  const rows = (data ?? []) as Array<{ id: string; provider: string; storage_bucket: string | null; storage_path: string | null; preview_path: string | null; thumbnail_path: string | null; deliverable_version_assets: Array<{ version_id: string }> }>;
  const linked = rows.filter((r) => r.deliverable_version_assets.length > 0).map((r) => r.id);
  const free = rows.filter((r) => r.deliverable_version_assets.length === 0);

  if (linked.length) {
    const { error: e } = await sb.from("file_assets").update({ archived_at: new Date().toISOString() }).eq("workspace_id", ctx.workspace.id).in("id", linked);
    if (e) return fail(e);
  }
  if (free.length) {
    const admin = createAdminClient();
    const byBucket = new Map<string, string[]>();
    for (const r of free) {
      if (r.provider !== "supabase") continue;
      const b = r.storage_bucket ?? BUCKET;
      byBucket.set(b, [...(byBucket.get(b) ?? []), ...[r.storage_path, r.preview_path, r.thumbnail_path].filter((p): p is string => Boolean(p))]);
    }
    for (const [bucket, paths] of byBucket) {
      if (paths.length) await admin.storage.from(bucket).remove(paths); // missing objects are ignored by Storage
    }
    const { error: e } = await admin.from("file_assets").delete().eq("workspace_id", ctx.workspace.id).in("id", free.map((r) => r.id));
    if (e) return fail(e);
  }
  revalidatePath("/app/arquivos");
  const parts = [free.length ? `${free.length} excluído(s)` : null, linked.length ? `${linked.length} em uso removido(s) da biblioteca (continuam no histórico do conteúdo)` : null].filter(Boolean);
  return { ok: true, data: { deleted: free.length, hidden: linked.length }, message: parts.join(" · ") + "." };
}
