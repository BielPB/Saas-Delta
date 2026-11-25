import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listClientsLite } from "@/lib/data";
import { isUuid } from "@/lib/utils";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { BatchBuilder } from "./builder";

export const metadata: Metadata = { title: "Gerar link de aprovação" };

export default async function NewBatchPage({ searchParams }: { searchParams: Promise<{ cliente?: string; ids?: string }> }) {
  const ctx = await requirePermission("approvals.manage");
  const sp = await searchParams;
  const sb = await createClient();
  const clients = await listClientsLite(ctx.workspace.id);
  const preIds = (sp.ids ?? "").split(",").filter(isUuid);
  let clientId = isUuid(sp.cliente) ? sp.cliente : undefined;
  if (!clientId && preIds.length) {
    const { data } = await sb.from("content_items").select("client_id").eq("id", preIds[0]).maybeSingle();
    clientId = (data?.client_id as string) ?? undefined;
  }

  let contents: Array<{ id: string; code: number; title: string; service: string | null; serviceId: string | null; planned: string | null; ready: boolean; approval: string; format: string }> = [];
  if (clientId) {
    const { data } = await sb.from("content_items")
      .select("id, code, title, planned_publish_at, approval_status, publication_status, service_id, client_services(name), content_formats(name), deliverables(required, client_facing, current_version_id, deliverable_versions!deliverables_current_version_fk(released_at))")
      .eq("client_id", clientId).is("archived_at", null).not("publication_status", "in", "(published,cancelled)")
      .order("planned_publish_at", { ascending: true, nullsFirst: false }).limit(300);
    contents = (data ?? []).map((c) => {
      const ds = (c.deliverables as unknown as Array<{ required: boolean; client_facing: boolean; deliverable_versions: { released_at: string | null } | null }>) ?? [];
      const cf = ds.filter((d) => d.required && d.client_facing);
      return {
        id: c.id as string, code: c.code as number, title: c.title as string, planned: c.planned_publish_at as string | null,
        service: (c.client_services as unknown as { name: string } | null)?.name ?? null, serviceId: c.service_id as string | null,
        format: (c.content_formats as unknown as { name: string } | null)?.name ?? "",
        approval: c.approval_status as string,
        ready: cf.length > 0 && cf.every((d) => Boolean(d.deliverable_versions?.released_at)),
      };
    });
  }
  const client = clients.find((c) => c.id === clientId);

  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow={<Link href="/app/aprovacoes" className="hover:text-fg">Aprovações</Link>} title="Gerar link de aprovação"
        description="Só conteúdos que passaram pela revisão interna podem ir para o cliente. O link é exclusivo, expira e pode ser revogado a qualquer momento." />
      <Panel>
        <BatchBuilder clients={clients} clientId={clientId} sensitive={client?.is_sensitive ?? false} contents={contents} preselected={preIds} />
      </Panel>
    </div>
  );
}
