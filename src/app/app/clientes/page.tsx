import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { monthStart } from "@/lib/format";
import { ButtonLink } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Clientes" };

interface ProgressRow {
  client_id: string; client_name: string; client_target: number; service_id: string | null; service_name: string; service_color: string;
  service_target: number | null; planned: number; videos_ready: number; covers_ready: number; captions_ready: number;
  approved: number; scheduled: number; published: number;
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await getContext();
  const sp = await searchParams;
  const sb = await createClient();
  const status = sp.status === "archived" || sp.status === "inactive" ? sp.status : "active";

  let q = sb.from("clients").select("id, name, company_name, segment, status, monthly_target, is_sensitive, client_services(count)")
    .eq("workspace_id", ctx.workspace.id).eq("status", status).order("name");
  if (sp.q) q = q.ilike("name", `%${sp.q.replace(/[%_]/g, "")}%`);
  const [{ data: clients }, { data: prog }, { data: open }] = await Promise.all([
    q,
    sb.rpc("client_progress", { p_ws: ctx.workspace.id, p_month: monthStart(), p_client: null }),
    sb.from("content_items").select("client_id, stage").eq("workspace_id", ctx.workspace.id).not("stage", "in", "(published,cancelled)").limit(3000),
  ]);
  const byClient = new Map<string, { target: number; approved: number }>();
  for (const r of (prog ?? []) as ProgressRow[]) {
    const e = byClient.get(r.client_id) ?? { target: r.client_target, approved: 0 };
    e.approved += Number(r.approved); // approved includes scheduled and published contents
    byClient.set(r.client_id, e);
  }
  const openBy = new Map<string, { producing: number; waiting: number; adjust: number }>();
  for (const c of (open ?? []) as Array<{ client_id: string; stage: string }>) {
    const e = openBy.get(c.client_id) ?? { producing: 0, waiting: 0, adjust: 0 };
    if (c.stage === "client_approval") e.waiting++;
    else if (c.stage === "adjustments") e.adjust++;
    else if (!["ready", "scheduled"].includes(c.stage)) e.producing++;
    openBy.set(c.client_id, e);
  }
  const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(new Date());
  const list = (clients ?? []) as Array<{ id: string; name: string; company_name: string | null; segment: string | null; monthly_target: number | null; is_sensitive: boolean; client_services: Array<{ count: number }> }>;

  return (
    <>
      <PageHeader title="Clientes"
        actions={ctx.can("clients.manage") && <ButtonLink href="/app/clientes/novo" variant="primary"><Plus /> Novo cliente</ButtonLink>} />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">{list.length} cliente(s) {status === "active" ? "ativo(s)" : status === "inactive" ? "inativo(s)" : "arquivado(s)"} · meta e andamento de {monthName}</p>
        <nav aria-label="Situação dos clientes" className="flex rounded-lg border border-border bg-surface p-0.5">
          {([["active", "Ativos", "/app/clientes"], ["inactive", "Inativos", "/app/clientes?status=inactive"], ["archived", "Arquivados", "/app/clientes?status=archived"]] as const).map(([k, label, href]) => (
            <Link key={k} href={href} aria-current={status === k ? "page" : undefined}
              className={cn("rounded-md px-3 py-1.5 text-[13px] text-muted transition-colors hover:text-fg", status === k && "bg-surface-3 font-medium text-fg")}>{label}</Link>
          ))}
        </nav>
      </div>

      {list.length === 0 ? (
        <section className="rounded-lg border border-border bg-surface">
          <EmptyState icon={<Building2 />} title={status === "active" ? "Nenhum cliente cadastrado" : "Nada por aqui"}
            description={status === "active" ? "Cadastre o primeiro cliente para começar a planejar conteúdos." : undefined}
            action={status === "active" && ctx.can("clients.manage") && <ButtonLink href="/app/clientes/novo" variant="primary"><Plus /> Cadastrar cliente</ButtonLink>} />
        </section>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {list.map((c) => {
            const e = byClient.get(c.id);
            const target = e?.target ?? c.monthly_target ?? 0;
            const approved = e?.approved ?? 0;
            const o = openBy.get(c.id);
            const subs = c.client_services[0]?.count ?? 0;
            const line = [
              c.segment,
              subs ? `${subs} subdivisão(ões)` : "sem subdivisões",
              o?.producing ? `${o.producing} em produção` : null,
              o?.waiting ? `${o.waiting} com o cliente` : null,
            ].filter(Boolean).join(" · ");
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 transition-colors hover:bg-surface-2/50">
                <div className="min-w-0 flex-1 basis-60">
                  <p className="flex items-center gap-2">
                    <Link href={`/app/clientes/${c.id}`} className="truncate text-[14px] font-semibold hover:underline">{c.name}</Link>
                    {c.is_sensitive && <Badge tone="warning">Sensível</Badge>}
                    {o?.adjust ? <Badge tone="warning">{o.adjust} em ajuste</Badge> : null}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">{line}</p>
                </div>
                <div className="w-48 shrink-0">
                  {target > 0 ? (
                    <>
                      <p className="mb-1 flex justify-between text-xs"><span className="text-muted">Meta do mês</span><span className="tabular font-medium">{approved} de {target}</span></p>
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={approved} aria-label={`Meta do mês de ${c.name}`}>
                        <div className={cn("h-full rounded-full", approved >= target ? "bg-accent" : "bg-fg/60")} style={{ width: `${Math.min(100, (approved / target) * 100)}%` }} />
                      </div>
                    </>
                  ) : <p className="text-xs text-subtle">Sem meta definida</p>}
                </div>
                <Link href={`/app/pipeline?cliente=${c.id}`} className="shrink-0 text-xs font-medium text-accent-ink hover:underline">Pipeline →</Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
