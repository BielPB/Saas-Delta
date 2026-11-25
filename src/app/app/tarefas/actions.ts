"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/errors";
import { fromLocalInput } from "@/lib/format";
import { isUuid } from "@/lib/utils";

async function call(fn: string, args: Record<string, unknown>, message: string): Promise<ActionResult> {
  await getContext();
  const sb = await createClient();
  const { error } = await sb.rpc(fn, args);
  if (error) return fail(error);
  revalidatePath("/app", "layout");
  return { ok: true, message };
}

export const startTask = async (id: string) => call("start_task", { p_task: id }, "Tarefa iniciada.");
export const completeTask = async (id: string) => call("complete_task", { p_task: id }, "Tarefa concluída. Próximas etapas liberadas.");
export const sendTaskToReview = async (id: string) => call("send_task_to_review", { p_task: id }, "Enviada para revisão da gestão.");
export const reopenTask = async (id: string, reason: string) => call("reopen_task", { p_task: id, p_reason: reason }, "Tarefa reaberta.");
export const cancelTask = async (id: string, reason: string) => call("cancel_task", { p_task: id, p_reason: reason || "Cancelada" }, "Tarefa cancelada.");

const taskSchema = z.object({
  title: z.string().trim().min(1, "Informe o título.").max(200),
  description: z.string().trim().max(5000).optional().transform((v) => v || null),
  client_id: z.string().uuid("Selecione o cliente."),
  content_id: z.string().optional().transform((v) => (isUuid(v) ? v : null)),
  assignee_id: z.string().optional().transform((v) => (isUuid(v) ? v : null)),
  due_at: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});

export async function createTask(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = taskSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Confira os campos.", Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  const d = parsed.data;
  const sb = await createClient();
  const { error } = await sb.from("tasks").insert({
    workspace_id: ctx.workspace.id, client_id: d.client_id, content_id: d.content_id, title: d.title, description: d.description,
    assignee_id: d.assignee_id, due_at: fromLocalInput(d.due_at, ctx.workspace.timezone), priority: d.priority,
    kind: "general", status: "pending", created_by: ctx.user.id,
  });
  if (error) return fail(error);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Tarefa criada." };
}

export async function updateTask(id: string, patch: { assignee_id?: string | null; due_at?: string | null; priority?: string; description?: string; checklist?: unknown }) {
  const ctx = await getContext();
  const sb = await createClient();
  const clean: Record<string, unknown> = {};
  if ("assignee_id" in patch) clean.assignee_id = isUuid(patch.assignee_id) ? patch.assignee_id : null;
  if ("due_at" in patch) clean.due_at = patch.due_at ? fromLocalInput(patch.due_at, ctx.workspace.timezone) : null;
  if (patch.priority && ["low", "medium", "high", "urgent"].includes(patch.priority)) clean.priority = patch.priority;
  if (typeof patch.description === "string") clean.description = patch.description.slice(0, 5000);
  if (Array.isArray(patch.checklist)) {
    clean.checklist = (patch.checklist as Array<{ id?: string; text?: string; done?: boolean }>).slice(0, 50).map((c, i) => ({
      id: String(c.id ?? i), text: String(c.text ?? "").slice(0, 300), done: Boolean(c.done),
    }));
  }
  const { error } = await sb.from("tasks").update(clean).eq("id", id).eq("workspace_id", ctx.workspace.id);
  if (error) return fail(error);
  revalidatePath("/app", "layout");
  return { ok: true as const, message: "Tarefa atualizada." };
}

export async function addComment(contentId: string, body: string, taskId?: string, versionId?: string) {
  const ctx = await getContext();
  const text = body.trim();
  if (text.length < 1) return fail("Escreva um comentário.");
  const sb = await createClient();
  const { error } = await sb.from("comments").insert({
    workspace_id: ctx.workspace.id, content_id: contentId, task_id: taskId ?? null, version_id: versionId ?? null,
    author_id: ctx.user.id, body: text.slice(0, 5000),
  });
  if (error) return fail(error);
  revalidatePath(`/app/conteudos/${contentId}`);
  if (taskId) revalidatePath(`/app/tarefas/${taskId}`);
  return { ok: true as const, message: "Comentário publicado." };
}
