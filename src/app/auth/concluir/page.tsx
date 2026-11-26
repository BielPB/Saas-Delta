"use client";
import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

/**
 * Landing for e-mail links that carry the session in the URL fragment (#access_token=…).
 * Supabase sends invites this way (no PKCE code), and the server never sees a fragment,
 * so /auth/callback forwards here (browsers keep the fragment across redirects).
 */
export default function FinishLinkPage() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    const nextRaw = query.get("next") ?? "/app";
    const access = hash.get("access_token");
    const refresh = hash.get("refresh_token");
    if (hash.get("error") || !access || !refresh) { requestAnimationFrame(() => setFailed(true)); return; }

    // An invited person has no password yet: they choose one first, then land in the workspace.
    const type = hash.get("type");
    const next = type === "invite" || type === "recovery" ? "/redefinir-senha"
      : /^\/(app|onboarding|redefinir-senha)/.test(nextRaw) ? nextRaw : "/app";

    getBrowserClient().auth.setSession({ access_token: access, refresh_token: refresh }).then(({ error }: { error: unknown }) => {
      if (error) { setFailed(true); return; }
      window.location.replace(next); // full load so the server reads the new session cookie
    });
  }, []);

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      {failed ? (
        <div className="max-w-sm text-center">
          <p className="text-sm font-medium">O link expirou ou já foi usado.</p>
          <p className="mt-1 text-sm text-muted">Peça um novo convite à agência ou entre com seu e-mail e senha.</p>
          <a href="/entrar" className="mt-4 inline-block text-sm font-medium text-accent-ink hover:underline">Ir para o login →</a>
        </div>
      ) : (
        <p className="text-sm text-muted" role="status">Entrando…</p>
      )}
    </main>
  );
}
