"use server";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/errors";
import { fromLocalInput } from "@/lib/format";
import { isUuid } from "@/lib/utils";
import { createBatch } from "@/app/app/aprovacoes/actions";

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

/**
 * "Enviar para aprovação" of the month's feed: releases every post whose files are all in
 * (same rule as the side panel), then creates one approval link with the posts ready for the client.
 */
export async function sendFeedForApproval(clientId: string, ym: string, contentIds: string[]): Promise<ActionResult<{ url: string; sent: number; skipped: number }>> {
  const ctx = await getContext();
  if (!isUuid(clientId) || !/^\d{4}-\d{2}$/.test(ym)) return fail("Seleção inválida.");
  const ids = [...new Set(contentIds.filter(isUuid))].slice(0, 200);
  if (!ids.length) return fail("Nenhum post neste mês.");
  const sb = await createClient();

  const readiness = async () => {
    const { data } = await sb.from("deliverables")
      .select("content_id, required, client_facing, current_version_id, deliverable_versions!deliverables_current_version_fk(released_at)")
      .in("content_id", ids);
    const by = new Map<string, { missing: boolean; unreleased: boolean }>();
    for (const d of (data ?? []) as unknown as Array<{ content_id: string; required: boolean; client_facing: boolean; current_version_id: string | null; deliverable_versions: { released_at: string | null } | null }>) {
      const e = by.get(d.content_id) ?? { missing: false, unreleased: false };
      if (d.required && !d.current_version_id) e.missing = true;
      if (d.required && d.client_facing && d.current_version_id && !d.deliverable_versions?.released_at) e.unreleased = true;
      by.set(d.content_id, e);
    }
    return by;
  };

  const before = await readiness();
  for (const id of ids) {
    const r = before.get(id);
    if (r && !r.missing && r.unreleased) await sb.rpc("submit_for_approval", { p_content: id }); // failures leave it out of the link
  }
  const after = await readiness();
  const { data: states } = await sb.from("content_items").select("id, approval_status, publication_status").in("id", ids);
  const ready = ids.filter((id) => {
    const r = after.get(id);
    const st = (states ?? []).find((s) => s.id === id) as { approval_status: string; publication_status: string } | undefined;
    return r && !r.missing && !r.unreleased && st && st.approval_status !== "approved" && !["published", "cancelled"].includes(st.publication_status);
  });
  if (!ready.length) return fail("Nenhum post está pronto para o cliente: envie a mídia e a legenda dos posts deste mês.");

  const { data: client } = await sb.from("clients").select("name").eq("id", clientId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  const label = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" }).format(new Date(`${ym}-15T12:00:00`)).replace(".", "").replace(" de ", "/");
  const r = await createBatch({ client_id: clientId, name: `Preview — ${client?.name ?? "Cliente"} · ${label}`, content_ids: ready });
  if (!r.ok) return r;
  refresh(clientId);
  return { ok: true, data: { url: r.data!.url, sent: ready.length, skipped: ids.length - ready.length } };
}
