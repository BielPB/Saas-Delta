import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "../auth-forms";

export const metadata: Metadata = { title: "Criar conta" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Criar conta</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Recebeu um convite? Use o mesmo e-mail do convite para entrar direto no workspace.</p>
      <SignUpForm />
      <p className="mt-6 text-center text-sm text-muted">
        Já tem conta? <Link href="/entrar" className="font-medium text-fg underline-offset-4 hover:underline">Entrar</Link>
      </p>
    </>
  );
}
