import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { NewPasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Nova senha" };

export default async function NewPasswordPage() {
  if (!(await getUser())) redirect("/entrar?erro=link");
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Definir nova senha</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Escolha uma senha que você não usa em outros serviços.</p>
      <NewPasswordForm />
    </>
  );
}
