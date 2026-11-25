import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { listClientsLite, listFormats, listMembers, listServicesLite, listTemplates } from "@/lib/data";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { NewContentForm } from "./form";

export const metadata: Metadata = { title: "Novo conteúdo" };

export default async function NewContentPage({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const ctx = await requirePermission("contents.manage");
  const sp = await searchParams;
  const ws = ctx.workspace.id;
  const [clients, services, formats, templates, members] = await Promise.all([
    listClientsLite(ws), listServicesLite(ws), listFormats(ws), listTemplates(ws), listMembers(ws),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow={<Link href="/app/conteudos" className="hover:text-fg">Conteúdos</Link>} title="Novo conteúdo"
        description="O template cria os entregáveis, as tarefas e as dependências entre etapas automaticamente." />
      {clients.length === 0 ? (
        <Panel><EmptyState title="Cadastre um cliente primeiro" action={<ButtonLink href="/app/clientes/novo" variant="primary">Cadastrar cliente</ButtonLink>} /></Panel>
      ) : (
        <Panel>
          <NewContentForm
            defaultClient={clients.some((c) => c.id === sp.cliente) ? sp.cliente : undefined}
            clients={clients} services={services.filter((s) => s.active)}
            formats={formats.filter((f) => f.active)} templates={templates.filter((t) => t.active)}
            members={members.filter((m) => m.status === "active" && m.user_id).map((m) => ({ id: m.user_id, name: m.full_name, roles: m.roles }))}
          />
        </Panel>
      )}
    </div>
  );
}
