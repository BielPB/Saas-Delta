"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { appOrigin } from "@/lib/origin";
import { fail, type ActionResult } from "@/lib/errors";

const email = z.string().trim().toLowerCase().email("Informe um e-mail válido.");
const password = z.string().min(8, "Use pelo menos 8 caracteres.");

function safeNext(v: FormDataEntryValue | null) {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/app") || s.startsWith("/onboarding") ? s : "/app";
}

async function origin() {
  return appOrigin();
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
  // Implicit flow on purpose: a PKCE link only works in the same browser that asked for it
  // (the code verifier lives in a cookie there), so opening the e-mail on the phone failed
  // with "link expirado ou já usado". The implicit link carries the session itself and
  // lands on /auth/concluir (or /auth/confirmar when the template uses the token hash).
  const env = publicEnv();
  const sb = createPlainClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await sb.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${await origin()}/auth/callback?next=/redefinir-senha` });
  if (error && (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit")) {
    return fail("Muitos pedidos seguidos. Aguarde alguns minutos e use o e-mail mais recente.");
  }
  // Same answer whether or not the account exists (no user enumeration).
  return { ok: true, message: "Se houver uma conta com esse e-mail, você receberá o link de redefinição." };
}

export async function updatePassword(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = password.safeParse(form.get("password"));
  if (!parsed.success) return fail(parsed.error.issues[0].message, { password: parsed.error.issues[0].message });
  if (form.get("password") !== form.get("confirm")) return fail("As senhas não conferem.", { confirm: "As senhas não conferem." });
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return fail("Sua sessão expirou. Peça um novo link em “Esqueci minha senha”.");
  const { error } = await sb.auth.updateUser({ password: parsed.data });
  if (error) {
    if (error.code === "same_password") return fail("A nova senha precisa ser diferente da atual.", { password: "Escolha uma senha diferente da atual." });
    if (error.code === "weak_password") return fail("Senha fraca. Misture letras, números e símbolos.", { password: "Senha fraca." });
    if (error.code === "session_not_found" || error.code === "session_expired" || error.status === 401 || error.status === 403) {
      return fail("Sua sessão expirou. Peça um novo link em “Esqueci minha senha”.");
    }
    return fail("Não foi possível salvar a nova senha. Tente de novo.");
  }
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
