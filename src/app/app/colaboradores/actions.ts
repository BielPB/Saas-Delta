"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { appOrigin } from "@/lib/origin";
import { fail, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/utils";

const invite = z.object({ email: z.string().trim().toLowerCase().email("E-mail inválido."), roles: z.array(z.string().regex(/^[a-z0-9_]{2,40}$/)).min(1, "Escolha ao menos uma função.") });

export async function inviteMember(input: { email: string; roles: string[] }): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = invite.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const sb = await createClient();
  const { error } = await sb.rpc("invite_member", { p_ws: ctx.workspace.id, p_email: parsed.data.email, p_role_keys: parsed.data.roles });
  if (error) return fail(error);
  let message = "Convite registrado. A pessoa entra no workspace ao criar conta ou entrar com este e-mail.";
  if (serverEnv().serviceRoleKey) {
    const origin = await appOrigin();
    const { error: mailErr } = await createAdminClient().auth.admin.inviteUserByEmail(parsed.data.email, {
      redirectTo: `${origin}/auth/callback?next=/app`, data: { invited_to: ctx.workspace.name },
    });
    if (!mailErr) message = "Convite enviado por e-mail.";
    else if (/already/i.test(mailErr.message)) message = "Esta pessoa já tem conta: ela verá o workspace no próximo login.";
  }
  revalidatePath("/app/colaboradores");
  return { ok: true, message };
}

export async function setRoles(memberId: string, roles: string[]): Promise<ActionResult> {
  const ctx = await getContext();
  const sb = await createClient();
  const { error } = await sb.rpc("set_member_roles", { p_ws: ctx.workspace.id, p_member: memberId, p_role_keys: roles });
  if (error) return fail(error);
  revalidatePath("/app/colaboradores");
  return { ok: true, message: "Funções atualizadas." };
}

export async function setStatus(memberId: string, active: boolean): Promise<ActionResult> {
  const ctx = await getContext();
  const sb = await createClient();
  const { error } = await sb.rpc("set_member_status", { p_ws: ctx.workspace.id, p_member: memberId, p_active: active });
  if (error) return fail(error);
  revalidatePath("/app/colaboradores");
  return { ok: true, message: active ? "Colaborador reativado." : "Colaborador desativado. O acesso foi bloqueado." };
}

export async function setMemberTarget(userId: string, target: number | null): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isUuid(userId)) return fail("Pessoa inválida.");
  if (target !== null && (!Number.isInteger(target) || target < 0 || target > 1000)) return fail("Use um número entre 0 e 1000.");
  const sb = await createClient();
  const { error } = await sb.rpc("set_member_target", { p_ws: ctx.workspace.id, p_user: userId, p_target: target });
  if (error) return fail(error);
  revalidatePath("/app/colaboradores");
  revalidatePath("/app");
  return { ok: true, message: "Meta atualizada." };
}
