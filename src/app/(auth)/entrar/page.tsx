import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "../auth-forms";
import { signInWithGoogle } from "../actions";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Entrar" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; erro?: string }> }) {
  const sp = await searchParams;
  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Entrar no Delta Flow</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Acesse o workspace da sua agência.</p>
      {sp.erro === "google" && <p role="alert" className="mb-4 text-sm text-[var(--tone-danger-fg)]">Não foi possível entrar com o Google.</p>}
      {sp.erro === "link" && <p role="alert" className="mb-4 text-sm text-[var(--tone-danger-fg)]">O link expirou ou já foi usado.</p>}
      <SignInForm next={sp.next} />
      {googleEnabled && (
        <form action={signInWithGoogle} className="mt-3">
          <input type="hidden" name="next" value={sp.next ?? "/app"} />
          <Button type="submit" className="w-full">Continuar com Google</Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-muted">
        Ainda não tem conta? <Link href="/cadastro" className="font-medium text-fg underline-offset-4 hover:underline">Criar conta</Link>
      </p>
    </>
  );
}
