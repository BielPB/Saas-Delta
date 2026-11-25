"use server";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/utils";
import { onboardingOf, profileFields, type OnboardingItem } from "@/lib/client-sheet";

export async function saveOnboarding(clientId: string, items: OnboardingItem[]): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isUuid(clientId)) return fail("Cliente inválido.");
  const list = onboardingOf(items.slice(0, 30));
  const sb = await createClient();
  const { error } = await sb.from("clients").update({ onboarding: list }).eq("id", clientId).eq("workspace_id", ctx.workspace.id);
  if (error) return fail(error);
  revalidatePath(`/app/clientes/${clientId}`);
  return { ok: true };
}

export async function saveProfile(clientId: string, values: Record<string, string>): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isUuid(clientId)) return fail("Cliente inválido.");
  const profile = Object.fromEntries(profileFields.map((f) => [f.key, String(values[f.key] ?? "").slice(0, 5000)]));
  const sb = await createClient();
  const { error } = await sb.from("clients").update({ profile }).eq("id", clientId).eq("workspace_id", ctx.workspace.id);
  if (error) return fail(error);
  revalidatePath(`/app/clientes/${clientId}`);
  return { ok: true, message: "Ficha salva." };
}

/**
 * "Duplicar mês": copies the month's posts to the next month as fresh posts
 * (same title, format, subdivision and briefing; date +1 month; no files, status Planejamento).
 */
export async function duplicateMonth(clientId: string, ym: string): Promise<ActionResult<{ count: number; target: string }>> {
  const ctx = await getContext();
  if (!isUuid(clientId) || !/^\d{4}-\d{2}$/.test(ym)) return fail("Seleção inválida.");
  const sb = await createClient();
  const next = (() => { const d = new Date(`${ym}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7); })();
  const m0 = `${ym}-01T00:00:00Z`; const m1 = `${next}-01T00:00:00Z`;
  const { data, error } = await sb.from("content_items").select("title, format_id, service_id, briefing, objective, channel, planned_publish_at, created_at")
    .eq("workspace_id", ctx.workspace.id).eq("client_id", clientId).is("archived_at", null).neq("publication_status", "cancelled")
    .or(`and(planned_publish_at.gte.${m0},planned_publish_at.lt.${m1}),and(planned_publish_at.is.null,created_at.gte.${m0},created_at.lt.${m1})`)
    .order("planned_publish_at", { ascending: true, nullsFirst: false }).limit(200);
  if (error) return fail(error);
  const rows = (data ?? []) as Array<{ title: string; format_id: string; service_id: string | null; briefing: string | null; objective: string | null; channel: string | null; planned_publish_at: string | null }>;
  if (!rows.length) return fail("Não há posts neste mês para duplicar.");
  const plusMonth = (iso: string) => {
    const d = new Date(iso);
    const day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last)); // 31/jan → 28/fev
    return d.toISOString();
  };
  let count = 0;
  for (const r of rows) {
    const { error: e } = await sb.rpc("create_content", {
      p_ws: ctx.workspace.id, p_client: clientId, p_format: r.format_id, p_title: r.title,
      p_fields: { service_id: r.service_id ?? "", briefing: r.briefing, objective: r.objective, channel: r.channel,
        planned_publish_at: r.planned_publish_at ? plusMonth(r.planned_publish_at) : `${next}-01T12:00:00Z` },
      p_assignees: {},
    });
    if (e) return fail(count ? `${count} post(s) duplicados, mas o restante falhou. Confira o mês seguinte antes de tentar de novo.` : e);
    count++;
  }
  revalidatePath(`/app/clientes/${clientId}`);
  return { ok: true, data: { count, target: next }, message: `${count} post(s) copiados para o mês seguinte.` };
}
