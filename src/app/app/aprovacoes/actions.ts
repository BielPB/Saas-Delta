"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/errors";
import { appOrigin } from "@/lib/origin";
import { fromLocalInput } from "@/lib/format";

const batch = z.object({
  client_id: z.string().uuid(),
  name: z.string().trim().min(1, "Dê um nome ao lote.").max(160),
  content_ids: z.array(z.string().uuid()).min(1, "Selecione ao menos um conteúdo.").max(200),
  due_at: z.string().optional(),
  expires_at: z.string().optional(),
  pin: z.string().regex(/^\d{4,8}$/, "PIN de 4 a 8 dígitos.").optional().or(z.literal("")),
});

export async function createBatch(input: z.input<typeof batch>): Promise<ActionResult<{ url: string; expires_at: string }>> {
  const ctx = await getContext();
  const parsed = batch.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const d = parsed.data;
  const tz = ctx.workspace.timezone;
  const sb = await createClient();
  const { data, error } = await sb.rpc("create_approval_batch", {
    p_ws: ctx.workspace.id, p_client: d.client_id, p_name: d.name, p_content_ids: d.content_ids,
    p_due_at: fromLocalInput(d.due_at, tz), p_expires_at: fromLocalInput(d.expires_at, tz), p_pin: d.pin || null,
  });
  if (error) return fail(error);
  const r = data as { token: string; expires_at: string; batch_id: string };
  revalidatePath("/app/aprovacoes");
  return { ok: true, data: { url: `${await appOrigin()}/aprovacao/${r.token}`, expires_at: r.expires_at } };
}

export async function rotateLink(batchId: string, expires: string | null, pin: string | null): Promise<ActionResult<{ url: string }>> {
  const ctx = await getContext();
  const sb = await createClient();
  const { data, error } = await sb.rpc("rotate_approval_link", {
    p_batch: batchId, p_expires_at: fromLocalInput(expires, ctx.workspace.timezone), p_pin: pin || null,
  });
  if (error) return fail(error);
  revalidatePath(`/app/aprovacoes/${batchId}`);
  return { ok: true, data: { url: `${await appOrigin()}/aprovacao/${(data as { token: string }).token}` } };
}

export async function revokeLink(linkId: string, batchId: string): Promise<ActionResult> {
  await getContext();
  const sb = await createClient();
  const { error } = await sb.rpc("revoke_approval_link", { p_link: linkId });
  if (error) return fail(error);
  revalidatePath(`/app/aprovacoes/${batchId}`);
  return { ok: true, message: "Link revogado. O acesso foi bloqueado imediatamente." };
}
