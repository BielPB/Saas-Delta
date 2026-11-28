"use server";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/errors";

export async function saveProfile(name: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!name.trim() || name.trim().length > 120) return fail("Informe seu nome.");
  const sb = await createClient();
  const { error } = await sb.from("profiles").update({ full_name: name.trim() }).eq("id", ctx.user.id);
  if (error) return fail(error);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Nome de exibição atualizado." };
}

const CATS = ["tasks", "approvals", "publications", "files", "system"];
export async function savePrefs(rows: Array<{ category: string; in_app: boolean; email: boolean; push: boolean }>): Promise<ActionResult> {
  const ctx = await getContext();
  const sb = await createClient();
  const clean = rows.filter((r) => CATS.includes(r.category)).map((r) => ({
    workspace_id: ctx.workspace.id, user_id: ctx.user.id, category: r.category, in_app: Boolean(r.in_app), email: Boolean(r.email), push: Boolean(r.push),
  }));
  const { error } = await sb.from("notification_preferences").upsert(clean, { onConflict: "workspace_id,user_id,category" });
  if (error) return fail(error);
  return { ok: true, message: "Preferências salvas." };
}

export async function changePassword(current: string, next: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (next.length < 8) return fail("A nova senha precisa de pelo menos 8 caracteres.");
  const sb = await createClient();
  const { error: reauth } = await sb.auth.signInWithPassword({ email: ctx.profile.email ?? "", password: current });
  if (reauth) return fail("Senha atual incorreta.");
  const { error } = await sb.auth.updateUser({ password: next });
  if (error) return fail("Não foi possível alterar a senha.");
  return { ok: true, message: "Senha alterada." };
}

export async function savePushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } } | null): Promise<ActionResult> {
  const ctx = await getContext();
  const sb = await createClient();
  if (!sub) {
    await sb.from("push_subscriptions").delete().eq("user_id", ctx.user.id);
    return { ok: true, message: "Notificações push desativadas." };
  }
  if (!/^https:\/\//.test(sub.endpoint)) return fail("Assinatura inválida.");
  const { error } = await sb.from("push_subscriptions").upsert({ user_id: ctx.user.id, endpoint: sub.endpoint, keys: sub.keys }, { onConflict: "endpoint" });
  if (error) return fail(error);
  return { ok: true, message: "Notificações push ativadas neste dispositivo." };
}
