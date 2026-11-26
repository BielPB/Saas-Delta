import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Stamp } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { relative, formatDateTime } from "@/lib/format";
import { ButtonLink } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Panel, Table } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Aprovações" };

export default async function ApprovalsPage() {
  const ctx = await requirePermission("approvals.manage");
  const sb = await createClient();
  const [{ data: batches }, { data: pending }] = await Promise.all([
    sb.from("approval_batches").select("id, name, status, created_at, submitted_at, due_at, clients(name), approval_batch_items(content_id), approval_links(id, expires_at, revoked_at, last_accessed_at)")
      .eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false }).limit(100),
    sb.from("content_items").select("id, approval_status").eq("workspace_id", ctx.workspace.id).in("approval_status", ["awaiting", "partially_approved"]).is("archived_at", null),
  ]);
  return (
    <>
      <PageHeader title="Aprovações" description={`${(pending ?? []).length} conteúdo(s) aguardando avaliação do cliente.`}
        actions={<ButtonLink href="/app/aprovacoes/novo" variant="primary"><Plus /> Gerar link de aprovação</ButtonLink>} />
      <Panel padded={false}>
        {(batches ?? []).length === 0 ? (
          <EmptyState icon={<Stamp />} title="Nenhum lote enviado" description="Monte um lote com os conteúdos revisados e envie o link pelo WhatsApp. O cliente aprova sem criar conta."
            action={<ButtonLink href="/app/aprovacoes/novo" variant="primary">Gerar primeiro link</ButtonLink>} />
        ) : (
          <Table>
            <thead><tr><th>Lote</th><th className="hidden sm:table-cell">Cliente</th><th className="hidden sm:table-cell">Conteúdos</th><th className="hidden lg:table-cell">Link</th><th>Status</th><th className="hidden md:table-cell">Criado</th></tr></thead>
            <tbody>
              {(batches ?? []).map((b) => {
                const links = (b.approval_links as unknown as Array<{ expires_at: string | null; revoked_at: string | null; last_accessed_at: string | null }>) ?? [];
                const live = links.find((l) => !l.revoked_at && (!l.expires_at || new Date(l.expires_at) > new Date()));
                return (
                  <tr key={b.id as string}>
                    <td>
                      <Link href={`/app/aprovacoes/${b.id}`} className="font-medium hover:underline">{b.name as string}</Link>
                      {/* Phones: client and count move under the batch name (their columns are hidden). */}
                      <span className="block text-xs text-muted sm:hidden">{(b.clients as unknown as { name: string })?.name} · {(b.approval_batch_items as unknown[]).length} conteúdo(s)</span>
                    </td>
                    <td className="hidden text-muted sm:table-cell">{(b.clients as unknown as { name: string })?.name}</td>
                    <td className="tabular hidden sm:table-cell">{(b.approval_batch_items as unknown[]).length}</td>
                    <td className="hidden lg:table-cell">{live ? <span className="text-xs text-muted">{live.last_accessed_at ? `aberto ${relative(live.last_accessed_at)}` : "não aberto"} · expira {formatDateTime(live.expires_at)}</span> : <Badge>Sem link ativo</Badge>}</td>
                    <td>{b.status === "submitted" ? <Badge tone="success">Avaliação finalizada</Badge> : <Badge tone="info">Aguardando cliente</Badge>}</td>
                    <td className="hidden text-muted md:table-cell">{relative(b.created_at as string)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
