"use server";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, type ActionResult } from "@/lib/errors";
import { appOrigin } from "@/lib/origin";
import { calendarToken, revokeToken } from "@/lib/calendar/google";
import { removeCreatedEvents, syncCalendar } from "@/lib/calendar/sync";

async function myConnection() {
  const ctx = await getContext();
  const sb = await createClient();
  const { data } = await sb.from("calendar_connections").select("id").eq("workspace_id", ctx.workspace.id).eq("user_id", ctx.user.id).maybeSingle();
  return { ctx, id: (data?.id as string | undefined) ?? null };
}

export async function updateCalendarSettings(patch: { share_with_team?: boolean; push_tasks?: boolean; push_posts?: boolean }): Promise<ActionResult> {
  const { ctx, id } = await myConnection();
  if (!id) return fail("Conecte sua agenda primeiro.");
  const clean = Object.fromEntries(Object.entries(patch).filter(([k, v]) => ["share_with_team", "push_tasks", "push_posts"].includes(k) && typeof v === "boolean"));
  const sb = await createClient();
  const { error } = await sb.from("calendar_connections").update(clean).eq("id", id).eq("user_id", ctx.user.id);
  if (error) return fail(error);
  if ("push_tasks" in clean || "push_posts" in clean) await syncCalendar(id, await appOrigin()).catch(() => {});
  revalidatePath("/app/conta");
  return { ok: true, message: "Preferência salva." };
}

export async function syncMyCalendar(): Promise<ActionResult> {
  const { id } = await myConnection();
  if (!id) return fail("Conecte sua agenda primeiro.");
  try {
    const r = await syncCalendar(id, await appOrigin());
    revalidatePath("/app/conta");
    return { ok: true, message: `Agenda atualizada (${r.created} novo(s), ${r.updated} alterado(s), ${r.deleted} removido(s)).` };
  } catch {
    revalidatePath("/app/conta");
    return fail("Não foi possível falar com o Google agora. Se continuar, desconecte e conecte de novo.");
  }
}

export async function disconnectCalendar(removeEvents: boolean): Promise<ActionResult> {
  const { id } = await myConnection();
  if (!id) return fail("Agenda não conectada.");
  if (removeEvents) await removeCreatedEvents(id);
  const token = await calendarToken(id).catch(() => null);
  if (token) await revokeToken(token);
  await createAdminClient().from("calendar_connections").delete().eq("id", id);
  revalidatePath("/app", "layout");
  return { ok: true, message: removeEvents ? "Agenda desconectada e eventos do Delta Flow removidos." : "Agenda desconectada." };
}
