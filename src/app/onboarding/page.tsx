import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { isConfigured } from "@/lib/env";
import { SetupRequired } from "@/components/setup-required";
import { Logo } from "@/components/logo";
import { CreateWorkspaceForm } from "./form";

export const metadata: Metadata = { title: "Criar workspace" };

export default async function OnboardingPage() {
  if (!isConfigured()) return <SetupRequired />;
  await requireUser();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Logo />
      <p className="mt-10 text-xs font-medium uppercase tracking-wider text-muted">Passo 1 de 10</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">Crie o workspace da sua agência</h1>
      <p className="mb-6 mt-1 text-sm text-muted">
        Clientes, equipe, conteúdos e aprovações ficam isolados neste workspace. Os demais passos (equipe, clientes, metas,
        Google Drive, pipeline) aparecem no painel e podem ser feitos depois.
      </p>
      <CreateWorkspaceForm />
    </main>
  );
}
