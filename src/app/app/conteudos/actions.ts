"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/errors";
import { fromLocalInput } from "@/lib/format";
import { isUuid } from "@/lib/utils";
import { BUCKET } from "@/lib/data";

const newContent = z.object({
  title: z.string().trim().min(1, "Informe o título.").max(200),
  client_id: z.string().uuid("Selecione o cliente."),
  format_id: z.string().uuid("Selecione o formato."),
  template_id: z.string().optional().transform((v) => (isUuid(v) ? v : "")),
  service_id: z.string().optional().transform((v) => (isUuid(v) ? v : "")),
  objective: z.string().trim().max(500).optional(),
  briefing: z.string().trim().max(10000).optional(),
  script: z.string().trim().max(20000).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  due_at: z.string().optional(),
  planned_publish_at: z.string().optional(),
  channel: z.string().optional(),
  stage: z.enum(["script", "capture", "editing", "finishing"]).optional(),
});

export async function createContentAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = newContent.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Confira os campos.", Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  const d = parsed.data;
  const assignees: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (k.startsWith("assignee:") && isUuid(v)) assignees[k.slice(9)] = v as string;
  }
  const tz = ctx.workspace.timezone;
  const sb = await createClient();
  const { data, error } = await sb.rpc("create_content", {
    p_ws: ctx.workspace.id, p_client: d.client_id, p_format: d.format_id, p_title: d.title,
    p_fields: {
      template_id: d.template_id, service_id: d.service_id, objective: d.objective, briefing: d.briefing, script: d.script,
      priority: d.priority, due_at: fromLocalInput(d.due_at, tz), planned_publish_at: fromLocalInput(d.planned_publish_at, tz),
      channel: d.channel && /^[a-z_]+$/.test(d.channel) ? d.channel : null,
    },
    p_assignees: assignees,
  });
  if (error) return fail(error);
  if (!d.template_id && d.stage && d.stage !== "script") await sb.rpc("set_work_status", { p_content: data as string, p_status: d.stage });
  const another = form.get("_another") === "1";
  revalidatePath("/app", "layout");
  if (another) return { ok: true, message: "Conteúdo criado. Preencha o próximo." };
  redirect(`/app/conteudos/${data}`);
}

const editable = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  objective: z.string().max(500).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  briefing: z.string().max(10000).nullable().optional(),
  script: z.string().max(20000).nullable().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  due_at: z.string().nullable().optional(),
  planned_publish_at: z.string().nullable().optional(),
  channel: z.string().regex(/^[a-z_]+$/).nullable().optional(),
  service_id: z.string().uuid().nullable().optional(),
});

/** Optimistic concurrency: the update only applies if nobody changed the content meanwhile. */
export async function updateContent(id: string, lockVersion: number, patch: z.input<typeof editable>): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = editable.safeParse(patch);
  if (!parsed.success) return fail("Confira os campos.");
  const d = { ...parsed.data };
  const tz = ctx.workspace.timezone;
  if ("due_at" in d) d.due_at = d.due_at ? fromLocalInput(d.due_at, tz) : null;
  if ("planned_publish_at" in d) d.planned_publish_at = d.planned_publish_at ? fromLocalInput(d.planned_publish_at, tz) : null;
  const sb = await createClient();
  const { data, error } = await sb.from("content_items").update(d).eq("id", id).eq("workspace_id", ctx.workspace.id)
    .eq("lock_version", lockVersion).select("id");
  if (error) return fail(error);
  if (!data?.length) return fail("Este conteúdo foi alterado por outra pessoa. Recarregue a página para ver a versão atual.");
  revalidatePath(`/app/conteudos/${id}`);
  return { ok: true, message: "Alterações salvas." };
}

export async function duplicateContent(id: string) {
  await getContext();
  const sb = await createClient();
  const { data, error } = await sb.rpc("duplicate_content", { p_content: id, p_title: null });
  if (error) return fail(error);
  redirect(`/app/conteudos/${data}`);
}

export async function archiveContents(ids: string[], archive = true) {
  const ctx = await getContext();
  const list = ids.filter(isUuid).slice(0, 200);
  if (!list.length) return fail("Selecione ao menos um conteúdo.");
  const sb = await createClient();
  const { data, error } = await sb.from("content_items").update({ archived_at: archive ? new Date().toISOString() : null })
    .in("id", list).eq("workspace_id", ctx.workspace.id).select("id");
  if (error) return fail(error);
  revalidatePath("/app", "layout");
  const n = data?.length ?? 0;
  return { ok: true as const, message: archive ? `${n} conteúdo(s) arquivado(s).` : `${n} conteúdo(s) restaurado(s).` };
}

export async function bulkFromForm(form: FormData) {
  const ids = form.getAll("ids").map(String).filter(isUuid);
  const op = form.get("op");
  if (op === "approval") redirect(`/app/aprovacoes/novo?ids=${ids.join(",")}`);
  if (op === "archive") await archiveContents(ids, true);
  if (op === "restore") await archiveContents(ids, false);
  revalidatePath("/app/conteudos");
}

export async function cancelContent(id: string, reason: string) {
  await getContext();
  const sb = await createClient();
  const { error } = await sb.rpc("cancel_content", { p_content: id, p_reason: reason || "Cancelado" });
  if (error) return fail(error);
  revalidatePath(`/app/conteudos/${id}`);
  return { ok: true as const, message: "Conteúdo cancelado." };
}

/* ---------------------------------------------------------------- files --- */
const assetMeta = z.object({
  path: z.string().min(10).max(600),
  name: z.string().min(1).max(255),
  mime: z.string().max(120),
  size: z.number().int().nonnegative(),
  client_id: z.string().uuid().nullable(),
  service_id: z.string().uuid().nullable().optional(),
  category: z.enum(["raw", "edited_video", "cover", "image", "carousel", "script", "document", "approved", "brand"]),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  duration: z.number().nonnegative().nullable().optional(),
});

/** Registers an object already uploaded straight to Storage (bytes never pass through the server). */
export async function registerAsset(meta: z.input<typeof assetMeta>): Promise<ActionResult<{ id: string }>> {
  const ctx = await getContext();
  const parsed = assetMeta.safeParse(meta);
  if (!parsed.success) return fail("Metadados do arquivo inválidos.");
  const m = parsed.data;
  if (!m.path.startsWith(`${ctx.workspace.id}/${m.client_id ?? "_shared"}/`)) return fail("Caminho de arquivo inválido.");
  const sb = await createClient();
  const { data, error } = await sb.from("file_assets").insert({
    workspace_id: ctx.workspace.id, client_id: m.client_id, service_id: m.service_id ?? null, provider: "supabase",
    storage_bucket: BUCKET, storage_path: m.path, name: m.name, mime_type: m.mime, size_bytes: m.size, category: m.category,
    width: m.width ?? null, height: m.height ?? null, duration_seconds: m.duration ?? null, created_by: ctx.user.id,
  }).select("id").single();
  if (error) return fail(error);
  return { ok: true, data: { id: data.id as string } };
}

export async function findDuplicate(client: string | null, name: string, size: number) {
  const ctx = await getContext();
  const sb = await createClient();
  let q = sb.from("file_assets").select("id, name, created_at").eq("workspace_id", ctx.workspace.id).eq("name", name).eq("size_bytes", size).is("archived_at", null).limit(1);
  q = client ? q.eq("client_id", client) : q.is("client_id", null);
  const { data } = await q;
  return (data?.[0] as { id: string; name: string; created_at: string } | undefined) ?? null;
}

export async function addVersion(input: { deliverable: string; content: string; text?: string | null; assets?: string[]; url?: string | null; reason?: string | null }): Promise<ActionResult> {
  await getContext();
  const sb = await createClient();
  const { error } = await sb.rpc("add_deliverable_version", {
    p_deliverable: input.deliverable, p_text: input.text ?? null, p_asset_ids: (input.assets ?? []).filter(isUuid),
    p_external_url: input.url ?? null, p_reason: input.reason ?? null,
  });
  if (error) return fail(error);
  revalidatePath(`/app/conteudos/${input.content}`);
  revalidatePath("/app/minhas-tarefas");
  return { ok: true, message: "Nova versão enviada." };
}

export async function invalidateApproval(deliverable: string, content: string, reason: string): Promise<ActionResult> {
  await getContext();
  const sb = await createClient();
  const { error } = await sb.rpc("invalidate_approval", { p_deliverable: deliverable, p_reason: reason });
  if (error) return fail(error);
  revalidatePath(`/app/conteudos/${content}`);
  return { ok: true, message: "Aprovação invalidada. Tarefa de ajuste criada." };
}

export async function setAssignees(content: string, users: string[]) {
  const ctx = await getContext();
  const sb = await createClient();
  await sb.from("content_assignees").delete().eq("content_id", content);
  const list = users.filter(isUuid);
  if (list.length) {
    const { error } = await sb.from("content_assignees").insert(list.map((u) => ({ workspace_id: ctx.workspace.id, content_id: content, user_id: u })));
    if (error) return fail(error);
  }
  revalidatePath(`/app/conteudos/${content}`);
  return { ok: true as const, message: "Responsáveis atualizados." };
}

/* ---------------------------------------------------------- publication --- */
export async function schedulePublication(content: string, at: string, channel: string | null, override: string | null): Promise<ActionResult> {
  const ctx = await getContext();
  const sb = await createClient();
  const { error } = await sb.rpc("schedule_publication", {
    p_content: content, p_scheduled_at: fromLocalInput(at, ctx.workspace.timezone), p_channel: channel, p_override_reason: override || null,
  });
  if (error) return fail(error);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Agendamento registrado." };
}

export async function confirmPublication(content: string, at: string, url: string | null): Promise<ActionResult> {
  const ctx = await getContext();
  const sb = await createClient();
  const { error } = await sb.rpc("confirm_publication", {
    p_content: content, p_published_at: fromLocalInput(at, ctx.workspace.timezone), p_url: url || null,
  });
  if (error) return fail(error);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Publicação confirmada." };
}

export async function unschedulePublication(content: string): Promise<ActionResult> {
  await getContext();
  const sb = await createClient();
  const { error } = await sb.rpc("unschedule_publication", { p_content: content });
  if (error) return fail(error);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Agendamento removido." };
}

export async function movePublication(content: string, isoAt: string): Promise<ActionResult> {
  await getContext();
  const sb = await createClient();
  const { error } = await sb.rpc("move_publication", { p_content: content, p_at: isoAt });
  if (error) return fail(error);
  revalidatePath("/app/calendario");
  return { ok: true, message: "Data atualizada." };
}

export async function signedUrl(path: string) {
  await getContext();
  const sb = await createClient();
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, 900);
  return data?.signedUrl ?? null;
}

/** Storage path of an asset the caller can read (RLS decides). */
export async function assetPath(id: string) {
  const ctx = await getContext();
  if (!isUuid(id)) return null;
  const sb = await createClient();
  const { data } = await sb.from("file_assets").select("storage_path").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  return (data?.storage_path as string | undefined) ?? null;
}
