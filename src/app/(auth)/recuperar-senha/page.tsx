import type { Metadata } from "next";
import Link from "next/link";
import { ResetRequestForm } from "../auth-forms";

export const metadata: Metadata = { title: "Recuperar senha" };

export default function ResetPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Recuperar senha</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Enviaremos um link para criar uma nova senha.</p>
      <ResetRequestForm />
      <p className="mt-6 text-center text-sm text-muted"><Link href="/entrar" className="hover:text-fg">Voltar para o login</Link></p>
    </>
  );
}
