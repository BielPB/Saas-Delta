"use server";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/utils";

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
