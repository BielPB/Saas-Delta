import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** OAuth / magic-link / recovery callback (PKCE code exchange). */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextRaw = url.searchParams.get("next") ?? "/app";
  const next = /^\/(app|onboarding|redefinir-senha)/.test(nextRaw) ? nextRaw : "/app";
  if (!code) return NextResponse.redirect(new URL("/entrar?erro=link", url.origin));

  const sb = await createClient();
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/entrar?erro=link", url.origin));
  await sb.rpc("accept_pending_invites");
  return NextResponse.redirect(new URL(next, url.origin));
}
