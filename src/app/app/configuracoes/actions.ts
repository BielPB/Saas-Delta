"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/errors";

const agency = z.object({
  name: z.string().trim().min(2).max(120),
  brand_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat("pt-BR", { timeZone: tz }); return true; } catch { return false; } }, "Fuso inválido."),
  logo_path: z.string().max(600).nullable().optional(),
});

export async function saveAgency(input: z.input<typeof agency>): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = agency.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  if (parsed.data.logo_path && !parsed.data.logo_path.startsWith(`${ctx.workspace.id}/_shared/`)) return fail("Logotipo inválido.");
  const sb = await createClient();
  const { error } = await sb.from("workspaces").update(parsed.data).eq("id", ctx.workspace.id);
  if (error) return fail(error);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Dados da agência salvos." };
}

const approvals = z.object({
  approval_default_expiry_days: z.coerce.number().int().min(1).max(90),
  approval_require_pin: z.boolean(),
  approval_stale_after_days: z.coerce.number().int().min(1).max(60),
  notify_email_enabled: z.boolean(),
  data_retention_months: z.coerce.number().int().min(1).max(120),
});

export async function saveSettings(input: z.input<typeof approvals>): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = approvals.safeParse(input);
  if (!parsed.success) return fail("Confira os valores.");
  const sb = await createClient();
  const { error } = await sb.from("workspace_settings").update(parsed.data).eq("workspace_id", ctx.workspace.id);
  if (error) return fail(error);
  revalidatePath("/app/configuracoes");
  return { ok: true, message: "Preferências salvas." };
}

export async function saveRole(input: { key: string; name: string; description: string; permissions: string[]; produces: string[] }): Promise<ActionResult> {
  const ctx = await getContext();
  const sb = await createClient();
  const { error } = await sb.rpc("save_role", {
    p_ws: ctx.workspace.id, p_key: input.key, p_name: input.name, p_description: input.description || null,
    p_permissions: input.permissions, p_produces: input.produces,
  });
  if (error) return fail(error);
  revalidatePath("/app/configuracoes");
  return { ok: true, message: "Função salva." };
}

export async function deleteRole(key: string): Promise<ActionResult> {
  const ctx = await getContext();
  const sb = await createClient();
  const { error } = await sb.rpc("delete_role", { p_ws: ctx.workspace.id, p_key: key });
  if (error) return fail(/role in use/.test(error.message) ? "Há colaboradores com esta função. Troque as funções deles antes." : error);
  revalidatePath("/app/configuracoes");
  return { ok: true, message: "Função removida." };
}

export async function toggleTemplate(id: string, active: boolean): Promise<ActionResult> {
  const ctx = await getContext();
  const sb = await createClient();
  const { error } = await sb.from("content_templates").update({ active }).eq("id", id).eq("workspace_id", ctx.workspace.id);
  if (error) return fail(error);
  revalidatePath("/app/configuracoes");
  return { ok: true, message: active ? "Template ativado." : "Template desativado." };
}

const step = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,30}$/), title: z.string().min(1).max(80), kind: z.enum(["production", "review", "general"]),
  role_key: z.string().regex(/^[a-z0-9_]{2,40}$/), deliverable_kind: z.enum(["script", "raw_footage", "video", "cover", "caption", "image", "carousel", "other"]).nullable(),
  depends_on: z.array(z.string()), offset_days: z.number().int().min(0).max(90),
});
const template = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(2).max(80), description: z.string().max(300).optional(),
  format_id: z.string().uuid(), steps: z.array(step).min(1).max(20),
}).refine((t) => {
  const keys = new Set(t.steps.map((s) => s.key));
  return keys.size === t.steps.length && t.steps.every((s) => s.depends_on.every((d) => keys.has(d) && d !== s.key));
}, "Etapas com chave repetida ou dependência inexistente.");

export async function saveTemplate(input: z.input<typeof template>): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = template.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { id, ...t } = parsed.data;
  // Reject cycles in the step DAG.
  const deps = new Map(t.steps.map((s) => [s.key, s.depends_on]));
  const visiting = new Set<string>(); const done = new Set<string>();
  const cyclic = (k: string): boolean => { if (done.has(k)) return false; if (visiting.has(k)) return true; visiting.add(k);
    const c = (deps.get(k) ?? []).some(cyclic); visiting.delete(k); done.add(k); return c; };
  if (t.steps.some((s) => cyclic(s.key))) return fail("As dependências entre etapas formam um ciclo.");
  const sb = await createClient();
  const { error } = id
    ? await sb.from("content_templates").update(t).eq("id", id).eq("workspace_id", ctx.workspace.id)
    : await sb.from("content_templates").insert({ ...t, workspace_id: ctx.workspace.id });
  if (error) return fail(error);
  revalidatePath("/app/configuracoes");
  return { ok: true, message: "Template salvo." };
}

export async function saveFormat(input: { key: string; name: string; required_kinds: string[]; aspect_ratio: string | null }): Promise<ActionResult> {
  const ctx = await getContext();
  if (!/^[a-z0-9_]{2,40}$/.test(input.key) || input.name.trim().length < 2) return fail("Informe nome e chave (letras minúsculas e _).");
  const sb = await createClient();
  const { error } = await sb.from("content_formats").upsert({
    workspace_id: ctx.workspace.id, key: input.key, name: input.name.trim(), required_kinds: input.required_kinds,
    aspect_ratio: input.aspect_ratio || null, active: true,
  }, { onConflict: "workspace_id,key" });
  if (error) return fail(error);
  revalidatePath("/app/configuracoes");
  return { ok: true, message: "Formato salvo." };
}
