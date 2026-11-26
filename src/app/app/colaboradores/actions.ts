"use server";
import { randomInt } from "node:crypto";
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
  const message = serverEnv().serviceRoleKey
    ? await sendInviteEmail(parsed.data.email, ctx.workspace.name)
    : "Convite registrado. A pessoa entra no workspace ao criar conta ou entrar com este e-mail.";
  revalidatePath("/app/colaboradores");
  return { ok: true, message };
}

const NO_MAIL = "O e-mail não pôde ser enviado agora: use “Gerar acesso” no menu … da pessoa e mande a senha pelo WhatsApp.";

async function findAuthUser(email: string) {
  const admin = createAdminClient();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return { error: true as const };
    const u = data.users.find((x) => x.email?.toLowerCase() === email);
    if (u) return { user: u };
    if (data.users.length < 1000) break;
  }
  return { user: null };
}

/**
 * Sends the invite e-mail. Supabase refuses a second invite once the account exists (the first
 * invite already created it), so for someone who never signed in we send a "set your password"
 * link instead. Both land on /auth/concluir and then /redefinir-senha.
 */
async function sendInviteEmail(email: string, workspaceName: string): Promise<string> {
  const admin = createAdminClient();
  const origin = await appOrigin();
  const redirectTo = `${origin}/auth/concluir?next=/redefinir-senha`;
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { invited_to: workspaceName } });
  if (!error) return "Convite enviado por e-mail. Peça para a pessoa olhar também o spam.";
  if (/rate limit|too many/i.test(error.message)) return `Limite de e-mails do Supabase atingido (plano gratuito: poucos por hora). Tente mais tarde ou: ${NO_MAIL}`;
  if (!/already|registered|exists/i.test(error.message)) return `Convite registrado. ${NO_MAIL}`;

  const found = await findAuthUser(email);
  if ("error" in found) return `Convite registrado. ${NO_MAIL}`;
  if (found.user?.last_sign_in_at) return "Esta pessoa já tem conta: ela verá o workspace no próximo login (ou usa “Esqueci minha senha”).";
  const { error: resetErr } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
  if (!resetErr) return "Convite reenviado por e-mail (chega com o assunto de redefinir senha). Peça para olhar também o spam.";
  if (/rate limit|too many|seconds/i.test(resetErr.message)) return `Limite de e-mails do Supabase atingido (plano gratuito: poucos por hora). Tente mais tarde ou: ${NO_MAIL}`;
  return `Convite registrado. ${NO_MAIL}`;
}

/** "Reenviar convite" for someone still marked as invited. */
export async function resendInvite(memberId: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx.can("members.manage")) return fail("Você não tem permissão para gerenciar a equipe.");
  if (!isUuid(memberId)) return fail("Convite inválido.");
  if (!serverEnv().serviceRoleKey) return fail("Chave de administrador do Supabase não configurada no servidor.");
  const sb = await createClient();
  const { data: m } = await sb.from("workspace_members").select("status, user_id, invited_email")
    .eq("id", memberId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!m || m.status !== "invited" || m.user_id || !m.invited_email) return fail("Este convite já foi aceito ou não existe mais.");
  return { ok: true, message: await sendInviteEmail(String(m.invited_email).toLowerCase(), ctx.workspace.name) };
}

/** Readable temporary password, e.g. "k7m3-p9x2-h4tq" (no 0/o/1/l/i to avoid typos). */
function tempPassword() {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => abc[randomInt(abc.length)]).join("")).join("-");
}

/**
 * "Gerar acesso": while e-mail is not configured, the manager creates the invited person's login
 * with a temporary password and sends it by WhatsApp. On first sign-in the invite is accepted
 * (accept_pending_invites). Never touches an account that has already signed in: that would let
 * a manager take over someone's real account.
 */
export async function generateAccess(memberId: string): Promise<ActionResult<{ email: string; password: string }>> {
  const ctx = await getContext();
  if (!ctx.can("members.manage")) return fail("Você não tem permissão para gerenciar a equipe.");
  if (!isUuid(memberId)) return fail("Convite inválido.");
  if (!serverEnv().serviceRoleKey) return fail("Chave de administrador do Supabase não configurada no servidor.");

  // The invite is read with the manager's own session (RLS), scoped to this workspace.
  const sb = await createClient();
  const { data: m } = await sb.from("workspace_members").select("id, status, user_id, invited_email")
    .eq("id", memberId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!m || m.status !== "invited" || m.user_id || !m.invited_email) return fail("Este convite já foi aceito ou não existe mais.");
  const email = String(m.invited_email).toLowerCase();

  const admin = createAdminClient();
  const found = await findAuthUser(email);
  if ("error" in found) return fail("Não foi possível consultar as contas. Tente de novo.");
  const existing = found.user ?? undefined;
  if (existing?.last_sign_in_at) {
    return fail("Esta pessoa já tem conta e já entrou no sistema: ela deve usar a senha dela (ou “Esqueci minha senha”).");
  }

  const password = tempPassword();
  const { error } = existing
    ? await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true })
    : await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) return fail("Não foi possível gerar o acesso. Tente de novo.");
  return { ok: true, message: "Acesso gerado.", data: { email, password } };
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

export async function removeMember(memberId: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isUuid(memberId)) return fail("Pessoa inválida.");
  const sb = await createClient();
  const { error } = await sb.rpc("remove_member", { p_ws: ctx.workspace.id, p_member: memberId });
  if (error) return fail(error);
  revalidatePath("/app/colaboradores");
  revalidatePath("/app", "layout");
  return { ok: true, message: "Removido da equipe." };
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
