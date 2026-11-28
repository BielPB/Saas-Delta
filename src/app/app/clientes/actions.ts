"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/utils";

const optional = z.string().trim().max(500).optional().transform((v) => (v ? v : null));
const clientSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do cliente.").max(160),
  company_name: optional, segment: optional, contact_name: optional, phone: optional,
  email: z.string().trim().email("E-mail inválido.").optional().or(z.literal("")).transform((v) => v || null),
  instagram: optional,
  website: z.string().trim().url("Use uma URL completa (https://…).").optional().or(z.literal("")).transform((v) => v || null),
  contract_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null),
  monthly_target: z.coerce.number().int().min(0).max(1000).default(0),
  notes: z.string().trim().max(5000).optional().transform((v) => v || null),
  is_sensitive: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  drive_folder_id: optional,
});

function fieldErrors(e: z.ZodError) {
  return Object.fromEntries(e.issues.map((i) => [String(i.path[0]), i.message]));
}

export async function saveClient(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await getContext();
  const id = form.get("id");
  const parsed = clientSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Confira os campos destacados.", fieldErrors(parsed.error));
  const sb = await createClient();
  if (isUuid(id)) {
    const { error } = await sb.from("clients").update(parsed.data).eq("id", id).eq("workspace_id", ctx.workspace.id);
    if (error) return fail(error);
    revalidatePath(`/app/clientes/${id}`);
    return { ok: true, message: "Cliente atualizado." };
  }
  const { data, error } = await sb.from("clients")
    .insert({ ...parsed.data, workspace_id: ctx.workspace.id, created_by: ctx.user.id }).select("id").single();
  if (error) return fail(error);
  // The creator is allocated so members without clients.view_all keep access.
  await sb.from("client_members").insert({ workspace_id: ctx.workspace.id, client_id: data.id, user_id: ctx.user.id });
  redirect(`/app/clientes/${data.id}?aba=servicos&novo=1`);
}

export async function renameClient(id: string, name: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx.can("clients.manage")) return fail("Sem permissão para gerenciar clientes.");
  const parsed = clientSchema.shape.name.safeParse(name);
  if (!isUuid(id) || !parsed.success) return fail("Informe um nome de até 160 caracteres.");
  const sb = await createClient();
  const { data, error } = await sb.from("clients").update({ name: parsed.data }).eq("workspace_id", ctx.workspace.id).eq("id", id).select("id").maybeSingle();
  if (error || !data) return fail(error ?? "Cliente não encontrado.");
  revalidatePath("/app", "layout");
  return { ok: true, message: "Cliente renomeado." };
}

export async function deleteClient(id: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isUuid(id) || !ctx.can("clients.manage")) return fail("Sem permissão para excluir este cliente.");
  const sb = await createClient();
  const { error } = await sb.rpc("delete_client", { p_ws: ctx.workspace.id, p_client: id });
  if (error) return fail(error);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Cliente excluído." };
}

export async function setClientStatus(id: string, status: "active" | "inactive" | "archived") {
  const ctx = await getContext();
  const sb = await createClient();
  const { error } = await sb.from("clients")
    .update({ status, archived_at: status === "archived" ? new Date().toISOString() : null })
    .eq("id", id).eq("workspace_id", ctx.workspace.id);
  if (error) return fail(error);
  revalidatePath("/app/clientes");
  revalidatePath(`/app/clientes/${id}`);
  return { ok: true as const, message: status === "archived" ? "Cliente arquivado." : status === "active" ? "Cliente ativado." : "Cliente desativado." };
}

const serviceSchema = z.object({
  client_id: z.string().uuid(),
  id: z.string().uuid().optional().or(z.literal("")),
  name: z.string().trim().min(1, "Informe o nome.").max(120),
  description: z.string().trim().max(1000).optional().transform((v) => v || null),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Cor inválida."),
  monthly_target: z.string().optional().transform((v) => (v === undefined || v === "" ? null : Math.max(0, Math.trunc(Number(v)) || 0))),
  drive_folder_id: z.string().trim().max(200).optional().transform((v) => v || null),
});

export async function saveService(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = serviceSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Confira os campos.", fieldErrors(parsed.error));
  const { id, ...rest } = parsed.data;
  const sb = await createClient();
  const { error } = id
    ? await sb.from("client_services").update(rest).eq("id", id).eq("workspace_id", ctx.workspace.id)
    : await sb.from("client_services").insert({ ...rest, workspace_id: ctx.workspace.id });
  if (error) return fail(error);
  revalidatePath(`/app/clientes/${rest.client_id}`);
  return { ok: true, message: id ? "Subdivisão atualizada." : "Subdivisão cadastrada." };
}

export async function toggleService(id: string, client: string, active: boolean) {
  const ctx = await getContext();
  const sb = await createClient();
  const { error } = await sb.from("client_services").update({ active }).eq("id", id).eq("workspace_id", ctx.workspace.id);
  if (error) return fail(error);
  revalidatePath(`/app/clientes/${client}`);
  return { ok: true as const, message: active ? "Subdivisão ativada." : "Subdivisão desativada." };
}

const targetSchema = z.object({
  client_id: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  service_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  format_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  target: z.coerce.number().int().min(0).max(1000),
});

export async function saveTarget(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = targetSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Confira os campos.", fieldErrors(parsed.error));
  const d = parsed.data;
  const sb = await createClient();
  const month = `${d.month}-01`;
  let del = sb.from("monthly_targets").delete().eq("workspace_id", ctx.workspace.id).eq("client_id", d.client_id).eq("month", month);
  del = d.service_id ? del.eq("service_id", d.service_id) : del.is("service_id", null);
  del = d.format_id ? del.eq("format_id", d.format_id) : del.is("format_id", null);
  await del;
  const { error } = await sb.from("monthly_targets").insert({ workspace_id: ctx.workspace.id, ...d, month });
  if (error) return fail(error);
  revalidatePath(`/app/clientes/${d.client_id}`);
  return { ok: true, message: "Meta salva." };
}

export async function deleteTarget(id: string, client: string) {
  const ctx = await getContext();
  const sb = await createClient();
  const { error } = await sb.from("monthly_targets").delete().eq("id", id).eq("workspace_id", ctx.workspace.id);
  if (error) return fail(error);
  revalidatePath(`/app/clientes/${client}`);
  return { ok: true as const, message: "Meta removida." };
}

export async function setClientMembers(client: string, userIds: string[]) {
  const ctx = await getContext();
  const sb = await createClient();
  const ids = userIds.filter(isUuid);
  const { data: current } = await sb.from("client_members").select("user_id").eq("client_id", client);
  const now = new Set((current ?? []).map((r) => r.user_id as string));
  const want = new Set(ids);
  const toAdd = ids.filter((u) => !now.has(u));
  const toRemove = [...now].filter((u) => !want.has(u));
  if (toAdd.length) {
    const { error } = await sb.from("client_members").insert(toAdd.map((u) => ({ workspace_id: ctx.workspace.id, client_id: client, user_id: u })));
    if (error) return fail(error);
  }
  if (toRemove.length) {
    const { error } = await sb.from("client_members").delete().eq("client_id", client).in("user_id", toRemove);
    if (error) return fail(error);
  }
  revalidatePath(`/app/clientes/${client}`);
  return { ok: true as const, message: "Equipe do cliente atualizada." };
}

export async function createCategory(name: string): Promise<ActionResult> {
  const ctx = await getContext();
  const n = name.trim().slice(0, 60);
  if (!n) return fail("Dê um nome para a categoria.");
  const sb = await createClient();
  const { data: last } = await sb.from("client_categories").select("position").eq("workspace_id", ctx.workspace.id).order("position", { ascending: false }).limit(1).maybeSingle();
  const { error } = await sb.from("client_categories").insert({ workspace_id: ctx.workspace.id, name: n, position: ((last?.position as number | undefined) ?? -1) + 1 });
  if (error) return fail(/duplicate|unique/i.test(error.message) ? "Já existe uma categoria com esse nome." : error);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Categoria criada." };
}

export async function renameCategory(categoryId: string, name: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx.can("clients.manage")) return fail("Você não tem permissão para gerenciar clientes.");
  if (!isUuid(categoryId)) return fail("Categoria inválida.");
  const n = name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!n) return fail("Dê um nome para a categoria.");
  const sb = await createClient();
  const { data, error } = await sb.from("client_categories").update({ name: n }).eq("id", categoryId).eq("workspace_id", ctx.workspace.id).select("id");
  if (error) return fail(/duplicate|unique/i.test(error.message) ? "Já existe uma categoria com esse nome." : error);
  if (!data?.length) return fail("Categoria não encontrada.");
  revalidatePath("/app", "layout");
  return { ok: true, message: "Categoria renomeada." };
}

export async function setClientCategory(clientId: string, categoryId: string | null): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isUuid(clientId) || (categoryId !== null && !isUuid(categoryId))) return fail("Seleção inválida.");
  const sb = await createClient();
  const { error } = await sb.from("clients").update({ category_id: categoryId }).eq("id", clientId).eq("workspace_id", ctx.workspace.id);
  if (error) return fail(error);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Cliente movido." };
}
