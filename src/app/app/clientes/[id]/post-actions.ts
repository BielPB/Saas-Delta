"use server";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/errors";
import { fromLocalInput } from "@/lib/format";
import { isUuid } from "@/lib/utils";

const refresh = (clientId?: string, contentId?: string) => {
  if (clientId) revalidatePath(`/app/clientes/${clientId}`);
  if (contentId) revalidatePath(`/app/conteudos/${contentId}`);
  revalidatePath("/app/pipeline");
};

/** Quick create from the client grid: no task template (simple workflow), only the format's deliverables. */
export async function createPost(input: { clientId: string; formatId: string; title: string; plannedAt?: string | null; serviceId?: string | null }): Promise<ActionResult<{ id: string }>> {
  const ctx = await getContext();
  if (!isUuid(input.clientId) || !isUuid(input.formatId)) return fail("Escolha o formato.");
  const title = input.title.trim().slice(0, 200);
  if (!title) return fail("Dê um título ao post.");
  const sb = await createClient();
  const { data, error } = await sb.rpc("create_content", {
    p_ws: ctx.workspace.id, p_client: input.clientId, p_format: input.formatId, p_title: title,
    p_fields: {
      service_id: input.serviceId && isUuid(input.serviceId) ? input.serviceId : "",
      planned_publish_at: input.plannedAt ? fromLocalInput(input.plannedAt, ctx.workspace.timezone) : null,
    },
    p_assignees: {},
  });
  if (error) return fail(error);
  refresh(input.clientId);
  return { ok: true, data: { id: data as string }, message: "Post criado." };
}

export async function setPostStatus(contentId: string, clientId: string, status: "planning" | "production" | "review"): Promise<ActionResult> {
  await getContext();
  if (!isUuid(contentId)) return fail("Post inválido.");
  const sb = await createClient();
  const { error } = await sb.rpc("set_work_status", { p_content: contentId, p_status: status });
  if (error) return fail(error);
  refresh(clientId, contentId);
  return { ok: true, message: "Status atualizado." };
}

export async function submitPost(contentId: string, clientId: string): Promise<ActionResult> {
  await getContext();
  if (!isUuid(contentId)) return fail("Post inválido.");
  const sb = await createClient();
  const { error } = await sb.rpc("submit_for_approval", { p_content: contentId });
  if (error) return fail(error);
  refresh(clientId, contentId);
  return { ok: true, message: "Liberado para aprovação. Inclua o post num link de aprovação para o cliente ver." };
}

export async function setEditor(contentId: string, clientId: string, userId: string | null): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isUuid(contentId) || (userId !== null && !isUuid(userId))) return fail("Seleção inválida.");
  const sb = await createClient();
  const { error } = await sb.from("content_items").update({ editor_id: userId }).eq("id", contentId).eq("workspace_id", ctx.workspace.id);
  if (error) return fail(error);
  refresh(clientId, contentId);
  return { ok: true, message: "Editor atualizado." };
}
