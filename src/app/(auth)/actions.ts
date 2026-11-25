"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/errors";

const email = z.string().trim().toLowerCase().email("Informe um e-mail válido.");
const password = z.string().min(8, "Use pelo menos 8 caracteres.");

function safeNext(v: FormDataEntryValue | null) {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/app") || s.startsWith("/onboarding") ? s : "/app";
}

async function origin() {
  const h = await headers();
  return process.env.NEXT_PUBLIC_APP_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

export async function signIn(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = z.object({ email, password: z.string().min(1, "Informe a senha.") }).safeParse({
    email: form.get("email"), password: form.get("password"),
  });
  if (!parsed.success) return fail("Confira os campos.", Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") return fail("Seu e-mail ainda não foi confirmado. Abra o link que enviamos ou peça à agência para liberar o acesso.");
    if (error.status === 429 || error.code === "over_request_rate_limit") return fail("Muitas tentativas. Aguarde alguns minutos e tente de novo.");
    return fail("E-mail ou senha incorretos.");
  }
  await sb.rpc("accept_pending_invites");
  redirect(safeNext(form.get("next")));
}

export async function signUp(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = z.object({ name: z.string().trim().min(2, "Informe seu nome."), email, password }).safeParse({
    name: form.get("name"), email: form.get("email"), password: form.get("password"),
  });
  if (!parsed.success) return fail("Confira os campos.", Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
  const sb = await createClient();
  const { data, error } = await sb.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.name }, emailRedirectTo: `${await origin()}/auth/callback?next=/onboarding` },
  });
  if (error) return fail(error.message.includes("registered") ? "Este e-mail já tem conta. Entre ou recupere a senha." : "Não foi possível criar a conta.");
  if (data.session) {
    await sb.rpc("accept_pending_invites");
    redirect("/app");
  }
  return { ok: true, message: "Enviamos um link de confirmação para o seu e-mail." };
}

export async function requestReset(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return fail("Informe um e-mail válido.", { email: "Informe um e-mail válido." });
  const sb = await createClient();
  await sb.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${await origin()}/auth/callback?next=/redefinir-senha` });
  // Same answer whether or not the account exists (no user enumeration).
  return { ok: true, message: "Se houver uma conta com esse e-mail, você receberá o link de redefinição." };
}

export async function updatePassword(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = password.safeParse(form.get("password"));
  if (!parsed.success) return fail(parsed.error.issues[0].message, { password: parsed.error.issues[0].message });
  if (form.get("password") !== form.get("confirm")) return fail("As senhas não conferem.", { confirm: "As senhas não conferem." });
  const sb = await createClient();
  const { error } = await sb.auth.updateUser({ password: parsed.data });
  if (error) return fail("Link expirado. Solicite uma nova redefinição.");
  redirect("/app");
}

export async function signInWithGoogle(form: FormData) {
  const sb = await createClient();
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(safeNext(form.get("next")))}` },
  });
  if (error || !data.url) redirect("/entrar?erro=google");
  redirect(data.url);
}

export async function signOut() {
  const sb = await createClient();
  await sb.auth.signOut();
  redirect("/entrar");
}
