"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessTokenFor, categoryFor, listChildren, listFilesDeep } from "@/lib/drive/google";
import { fail, type ActionResult } from "@/lib/errors";

/** Verifies the connection belongs to the caller's workspace (RLS read) before using the service role. */
async function ownedConnection(connectionId: string) {
  const ctx = await getContext();
  if (!ctx.can("integrations.manage")) throw new Error("permission_denied");
  const sb = await createClient();
  const { data } = await sb.from("drive_connections").select("id, workspace_id, status").eq("id", connectionId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!data) throw new Error("not_found");
  return { ctx, conn: data };
}

const driveMessage = (e: unknown) => {
  const m = e instanceof Error ? e.message : "";
  if (m === "drive_revoked") return "O acesso ao Google Drive foi revogado. Conecte a conta novamente.";
  if (m === "drive_rate_limited") return "O Google Drive limitou as requisições. Tente novamente em alguns minutos.";
  if (/drive_api_404/.test(m)) return "Pasta não encontrada ou sem permissão nesta conta Google.";
  if (/permission_denied/.test(m)) return "Você não tem permissão para gerenciar integrações.";
  return "Não foi possível falar com o Google Drive agora. Seus dados no Delta Flow não foram afetados.";
};

export async function browseFolder(connectionId: string, folderId: string): Promise<ActionResult<Array<{ id: string; name: string }>>> {
  try {
    const { conn } = await ownedConnection(connectionId);
    const token = await accessTokenFor(conn.id);
    const folders = await listChildren(token, folderId || "root", true);
    return { ok: true, data: folders.map((f) => ({ id: f.id, name: f.name })) };
  } catch (e) {
    return fail(driveMessage(e));
  }
}

const mapping = z.object({
  connection_id: z.string().uuid(), drive_folder_id: z.string().regex(/^[a-zA-Z0-9_-]{5,200}$/), folder_name: z.string().min(1).max(300),
  folder_path: z.string().max(1000).optional(), client_id: z.string().uuid(), service_id: z.string().uuid().nullable().optional(),
  category: z.enum(["raw", "edited_video", "cover", "image", "carousel", "script", "document", "approved", "brand"]).nullable().optional(),
});

export async function mapFolder(input: z.input<typeof mapping>): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = mapping.safeParse(input);
  if (!parsed.success) return fail("Dados da pasta inválidos.");
  const sb = await createClient();
  const { error } = await sb.from("drive_folder_mappings").upsert({ ...parsed.data, workspace_id: ctx.workspace.id }, { onConflict: "workspace_id,drive_folder_id" });
  if (error) return fail(error);
  if (!parsed.data.service_id) await sb.from("clients").update({ drive_folder_id: parsed.data.drive_folder_id }).eq("id", parsed.data.client_id);
  else await sb.from("client_services").update({ drive_folder_id: parsed.data.drive_folder_id }).eq("id", parsed.data.service_id);
  revalidatePath("/app/integracoes");
  return { ok: true, message: "Pasta vinculada. Rode a sincronização para importar as referências." };
}

export async function removeMapping(id: string): Promise<ActionResult> {
  const ctx = await getContext();
  const sb = await createClient();
  const { error } = await sb.from("drive_folder_mappings").delete().eq("id", id).eq("workspace_id", ctx.workspace.id);
  if (error) return fail(error);
  revalidatePath("/app/integracoes");
  return { ok: true, message: "Vínculo removido. Arquivos já importados continuam no Delta Flow." };
}

/**
 * Manual sync: imports REFERENCES (no bytes) of every file in the mapped
 * folder tree. Idempotent: unique (workspace_id, drive_file_id) prevents
 * duplicates; files no longer present are flagged "missing", never deleted.
 */
export async function syncMapping(mappingId: string): Promise<ActionResult<{ seen: number; created: number; missing: number }>> {
  const ctx = await getContext();
  if (!ctx.can("integrations.manage") && !ctx.can("files.manage")) return fail("Você não tem permissão para sincronizar.");
  const sb = await createClient();
  const { data: m } = await sb.from("drive_folder_mappings").select("*").eq("id", mappingId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!m) return fail("Vínculo não encontrado.");
  const admin = createAdminClient();
  const { data: job, error: jobErr } = await admin.from("drive_sync_jobs")
    .insert({ workspace_id: ctx.workspace.id, mapping_id: m.id, trigger: "manual", started_by: ctx.user.id }).select("id").single();
  if (jobErr) return fail("Já existe uma sincronização em andamento para esta pasta.");

  try {
    const token = await accessTokenFor(m.connection_id);
    const files = await listFilesDeep(token, m.drive_folder_id);
    const now = new Date().toISOString();
    const { data: existing } = await admin.from("file_assets").select("id, drive_file_id").eq("workspace_id", ctx.workspace.id).in("drive_file_id", files.map((f) => f.id).concat(["-"]));
    const known = new Set((existing ?? []).map((e) => e.drive_file_id as string));
    const rows = files.map((f) => ({
      workspace_id: ctx.workspace.id, client_id: m.client_id, service_id: m.service_id, provider: "drive" as const,
      drive_file_id: f.id, drive_parent_id: f.parents?.[0] ?? null, name: f.name, mime_type: f.mimeType,
      size_bytes: f.size ? Number(f.size) : null, category: categoryFor(f.mimeType, f.path, m.category),
      width: f.videoMediaMetadata?.width ?? f.imageMediaMetadata?.width ?? null, height: f.videoMediaMetadata?.height ?? f.imageMediaMetadata?.height ?? null,
      duration_seconds: f.videoMediaMetadata?.durationMillis ? Number(f.videoMediaMetadata.durationMillis) / 1000 : null,
      drive_modified_at: f.modifiedTime ?? null, status: "available" as const, last_seen_at: now, created_by: ctx.user.id, drive_mapping_id: m.id,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("file_assets").upsert(rows.slice(i, i + 500), { onConflict: "workspace_id,drive_file_id", ignoreDuplicates: false });
      if (error) throw error;
    }
    // References previously imported by THIS mapping that were not seen now → missing (never deleted).
    const { data: missingRows } = await admin.from("file_assets").update({ status: "missing" })
      .eq("workspace_id", ctx.workspace.id).eq("drive_mapping_id", m.id).lt("last_seen_at", now)
      .neq("status", "missing").is("archived_at", null).select("id");
    const created = files.filter((f) => !known.has(f.id)).length;
    await admin.from("drive_sync_jobs").update({ status: "done", finished_at: new Date().toISOString(), files_seen: files.length, files_new: created, files_missing: missingRows?.length ?? 0 }).eq("id", job.id);
    await admin.from("drive_folder_mappings").update({ last_synced_at: new Date().toISOString() }).eq("id", m.id);
    revalidatePath("/app/integracoes");
    revalidatePath("/app/arquivos");
    return { ok: true, data: { seen: files.length, created, missing: missingRows?.length ?? 0 }, message: `${files.length} arquivo(s) verificados, ${created} novo(s).` };
  } catch (e) {
    await admin.from("drive_sync_jobs").update({ status: "failed", finished_at: new Date().toISOString(), error: e instanceof Error ? e.message : "erro" }).eq("id", job.id);
    return fail(driveMessage(e));
  }
}

export async function disconnectDrive(connectionId: string): Promise<ActionResult> {
  try {
    const { ctx, conn } = await ownedConnection(connectionId);
    const admin = createAdminClient();
    await admin.from("drive_credentials").delete().eq("connection_id", conn.id);
    await admin.from("drive_connections").update({ status: "revoked" }).eq("id", conn.id);
    await admin.from("audit_logs").insert({ workspace_id: ctx.workspace.id, actor_id: ctx.user.id, action: "integration.drive_disconnected", entity_type: "drive_connection", entity_id: conn.id });
    revalidatePath("/app/integracoes");
    return { ok: true, message: "Conta desconectada. Tokens apagados do servidor." };
  } catch (e) {
    return fail(driveMessage(e));
  }
}

/** Queues a private copy + browser-safe preview of a Drive file (processed by the worker). */
export async function requestPreview(assetId: string): Promise<ActionResult> {
  const ctx = await getContext();
  const sb = await createClient();
  const { data: a } = await sb.from("file_assets").select("id, provider").eq("id", assetId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!a) return fail("Arquivo não encontrado.");
  const { error } = await createAdminClient().from("background_jobs").insert({
    workspace_id: ctx.workspace.id, type: "generate_preview", payload: { asset_id: assetId, requested_by: ctx.user.id }, idempotency_key: `preview:${assetId}`,
  });
  if (error && !/duplicate/.test(error.message)) return fail(error);
  await sb.from("file_assets").update({ status: "processing" }).eq("id", assetId);
  revalidatePath("/app/arquivos");
  return { ok: true, message: "Pré-visualização na fila. Assim que pronta, ela aparece no portal do cliente." };
}
