import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { deliverableKind, type ApprovalStatus, type DeliverableKind, type VersionStatus } from "@/lib/domain";
import { formatDateTime, relative } from "@/lib/format";
import { isUuid } from "@/lib/utils";
import { Badge, PageHeader, Panel, Table } from "@/components/ui/primitives";
import { ApprovalBadge, VersionBadge } from "@/components/content/badges";
import { LinkControls } from "./link-controls";

export const metadata: Metadata = { title: "Lote de aprovação" };

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requirePermission("approvals.manage");
  const sb = await createClient();
  const { data: b } = await sb.from("approval_batches").select("id, name, status, created_at, submitted_at, due_at, client_id, clients(name, is_sensitive)")
    .eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!b) notFound();
  const [{ data: items }, { data: links }, { data: responses }] = await Promise.all([
    sb.from("approval_batch_items").select("position, content_items(id, code, title, approval_status, deliverables(id, kind, title, client_facing, approval_status, current_version_id))").eq("batch_id", id).order("position"),
    sb.from("approval_links").select("id, token_hint, expires_at, revoked_at, created_at, last_accessed_at, pin_hash, failed_attempts, locked_until").eq("batch_id", id).order("created_at", { ascending: false }),
    sb.from("approval_responses").select("id, content_id, deliverable_id, decision, comment, reviewer_name, created_at").eq("batch_id", id).order("created_at", { ascending: false }),
  ]);
  const client = b.clients as unknown as { name: string; is_sensitive: boolean };
  const live = (links ?? []).find((l) => !l.revoked_at && (!l.expires_at || new Date(l.expires_at as string) > new Date()));

  return (
    <>
      <PageHeader eyebrow={<Link href="/app/aprovacoes" className="hover:text-fg">Aprovações</Link>} title={b.name as string}
        description={`${client.name} · criado ${relative(b.created_at as string)}${b.submitted_at ? ` · avaliação finalizada ${relative(b.submitted_at as string)}` : ""}`} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Panel title="Conteúdos do lote" padded={false}>
            <Table>
              <thead><tr><th>Conteúdo</th><th>Entregáveis</th><th>Status</th></tr></thead>
              <tbody>
                {(items ?? []).map((it) => {
                  const c = it.content_items as unknown as { id: string; code: number; title: string; approval_status: ApprovalStatus; deliverables: Array<{ id: string; kind: DeliverableKind; title: string; client_facing: boolean; approval_status: VersionStatus; current_version_id: string | null }> };
                  return (
                    <tr key={c.id}>
                      <td><Link href={`/app/conteudos/${c.id}`} className="font-medium hover:underline"><span className="font-mono text-xs text-subtle">#{c.code}</span> {c.title}</Link></td>
                      <td><div className="flex flex-wrap gap-1">{c.deliverables.filter((d) => d.client_facing).map((d) => (
                        <span key={d.id} className="inline-flex items-center gap-1 text-xs text-muted">{deliverableKind[d.kind]} <VersionBadge s={d.approval_status} /></span>
                      ))}</div></td>
                      <td><ApprovalBadge s={c.approval_status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Panel>
          <Panel title="Avaliações registradas" padded={false}>
            {(responses ?? []).length === 0 ? <p className="px-4 py-4 text-[13px] text-muted">O cliente ainda não avaliou.</p> : (
              <ul className="divide-y divide-border">
                {(responses ?? []).map((r) => (
                  <li key={r.id as string} className="px-4 py-2 text-[13px]">
                    <span className="font-medium">{(r.reviewer_name as string) ?? "Cliente"}</span>{" "}
                    {r.decision === "approved" ? <Badge tone="success">aprovou</Badge> : <Badge tone="danger">reprovou</Badge>}{" "}
                    <span className="text-xs text-subtle">{formatDateTime(r.created_at as string)}</span>
                    {r.comment && <p className="mt-0.5 text-muted">“{r.comment as string}”</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <aside className="space-y-4">
          <Panel title="Link de acesso">
            {live ? (
              <dl className="grid grid-cols-[100px_1fr] gap-y-1.5 text-[13px]">
                <dt className="text-muted">Final do token</dt><dd className="font-mono">…{live.token_hint as string}</dd>
                <dt className="text-muted">Expira</dt><dd>{formatDateTime(live.expires_at as string)}</dd>
                <dt className="text-muted">PIN</dt><dd>{live.pin_hash ? "Sim" : "Não"}</dd>
                <dt className="text-muted">Último acesso</dt><dd>{live.last_accessed_at ? relative(live.last_accessed_at as string) : "nunca"}</dd>
                {live.locked_until && new Date(live.locked_until as string) > new Date() && <><dt className="text-muted">Bloqueio</dt><dd className="text-[var(--tone-danger-fg)]">tentativas de PIN excedidas</dd></>}
              </dl>
            ) : <p className="text-[13px] text-muted">Nenhum link ativo. Gere um novo para reenviar ao cliente.</p>}
            <LinkControls batchId={id} liveLinkId={(live?.id as string) ?? null} sensitive={client.is_sensitive} />
          </Panel>
          <Panel title="Links anteriores" padded={false}>
            <ul className="divide-y divide-border text-xs">
              {(links ?? []).filter((l) => l.id !== live?.id).map((l) => (
                <li key={l.id as string} className="px-4 py-2 text-muted">…{l.token_hint as string} · {l.revoked_at ? `revogado ${relative(l.revoked_at as string)}` : "expirado"}</li>
              ))}
              {(links ?? []).filter((l) => l.id !== live?.id).length === 0 && <li className="px-4 py-2 text-muted">—</li>}
            </ul>
          </Panel>
        </aside>
      </div>
    </>
  );
}
