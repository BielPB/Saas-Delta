"use client";
import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

type OtpType = "invite" | "recovery" | "email" | "signup" | "magiclink" | "email_change";
const TYPES: OtpType[] = ["invite", "recovery", "email", "signup", "magiclink", "email_change"];

/**
 * Landing for every Supabase e-mail link (templates point here with {{ .TokenHash }}).
 * The one-time token is spent only when the person clicks the button: e-mail scanners
 * (Gmail, antivirus, Outlook Safe Links) open links automatically and used to burn
 * them before the person did.
 */
export default function ConfirmPage() {
  const [params, setParams] = useState<{ token: string; type: OtpType } | null | undefined>(undefined);
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const token = q.get("token_hash") ?? "";
    const type = q.get("type") as OtpType | null;
    requestAnimationFrame(() => setParams(token && type && TYPES.includes(type) ? { token, type } : null));
  }, []);

  const go = async () => {
    if (!params) return;
    setState("busy");
    const { error } = await getBrowserClient().auth.verifyOtp({ token_hash: params.token, type: params.type });
    if (error) { setState("failed"); return; }
    // Invited / recovering people choose a password first; new sign-ups go to onboarding (which also accepts invites).
    window.location.replace(params.type === "invite" || params.type === "recovery" ? "/redefinir-senha" : params.type === "email" || params.type === "signup" ? "/onboarding" : "/app");
  };

  const title = params?.type === "invite" ? "Você foi convidado para o Delta Flow"
    : params?.type === "recovery" ? "Redefinir sua senha" : "Confirmar acesso";

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 text-center">
        {params === undefined ? (
          <p className="text-sm text-muted" role="status">Carregando…</p>
        ) : params === null || state === "failed" ? (
          <>
            <p className="font-medium">Este link não vale mais.</p>
            <p className="mt-1 text-sm text-muted">Ele pode ter expirado ou sido substituído por um mais novo. Use o e-mail mais recente ou peça para a agência reenviar o convite.</p>
            <a href="/entrar" className="mt-4 inline-block text-sm font-medium text-accent-ink hover:underline">Ir para o login →</a>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted">{params.type === "invite" ? "Clique para entrar e criar sua senha." : "Clique para continuar."}</p>
            <button type="button" onClick={go} disabled={state === "busy"}
              className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg hover:brightness-95 disabled:opacity-60">
              {state === "busy" ? "Entrando…" : params.type === "invite" ? "Aceitar convite e entrar" : "Continuar"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
