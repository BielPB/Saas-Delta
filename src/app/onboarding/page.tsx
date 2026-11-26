import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";
import { SetupRequired } from "@/components/setup-required";
import { Logo } from "@/components/logo";
import { CreateWorkspaceForm } from "./form";

export const metadata: Metadata = { title: "Criar workspace" };

export default async function OnboardingPage() {
  if (!isConfigured()) return <SetupRequired />;
  await requireUser();
  // Someone with a pending invite must join that workspace instead of creating a new one.
  const sb = await createClient();
  const { data: accepted } = await sb.rpc("accept_pending_invites");
  if (Number(accepted) > 0) redirect("/app");
  const { count } = await sb.from("workspace_members").select("id", { count: "exact", head: true }).eq("status", "active");
  if ((count ?? 0) > 0) redirect("/app");
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
