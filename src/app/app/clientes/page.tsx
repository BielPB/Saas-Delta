import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { monthStart } from "@/lib/format";
import { ButtonLink } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Panel, Progress, Table } from "@/components/ui/primitives";
import { ServiceDot } from "@/components/content/badges";

export const metadata: Metadata = { title: "Clientes" };

interface ProgressRow {
  client_id: string; client_name: string; client_target: number; service_id: string | null; service_name: string; service_color: string;
  service_target: number | null; planned: number; videos_ready: number; covers_ready: number; captions_ready: number;
  approved: number; scheduled: number; published: number;
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ visao?: string; status?: string; q?: string }> }) {
  const ctx = await getContext();
  const sp = await searchParams;
  const sb = await createClient();
  const progressView = sp.visao === "progresso";
  const status = sp.status === "archived" || sp.status === "inactive" ? sp.status : "active";

  let q = sb.from("clients").select("id, name, company_name, segment, status, monthly_target, is_sensitive, client_services(count), client_members(count)")
    .eq("workspace_id", ctx.workspace.id).eq("status", status).order("name");
  if (sp.q) q = q.ilike("name", `%${sp.q.replace(/[%_]/g, "")}%`);
  const [{ data: clients }, { data: prog }] = await Promise.all([
    q,
    sb.rpc("client_progress", { p_ws: ctx.workspace.id, p_month: monthStart(), p_client: null }),
  ]);
  const rows = (prog ?? []) as ProgressRow[];
  const byClient = new Map<string, { target: number; produced: number; published: number; rows: ProgressRow[] }>();
  for (const r of rows) {
    const e = byClient.get(r.client_id) ?? { target: r.client_target, produced: 0, published: 0, rows: [] };
    e.produced += Number(r.approved); // approved includes scheduled and published contents
    e.published += Number(r.published);
    e.rows.push(r);
    byClient.set(r.client_id, e);
  }

  const tab = (key: string, label: string, href: string) => (
    <Link href={href} aria-current={(progressView ? "progresso" : status) === key ? "page" : undefined}
      className="rounded-md px-2.5 py-1 text-[13px] text-muted hover:text-fg aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium aria-[current=page]:text-fg">{label}</Link>
  );

  return (
    <>
      <PageHeader title="Clientes" description="Cadastro, metas mensais e progresso de entregas por cliente."
        actions={ctx.can("clients.manage") && <ButtonLink href="/app/clientes/novo" variant="primary"><Plus /> Novo cliente</ButtonLink>} />
      <nav className="mb-4 flex gap-1" aria-label="Filtro de clientes">
        {tab("active", "Ativos", "/app/clientes")}
        {tab("progresso", "Progresso do mês", "/app/clientes?visao=progresso")}
        {tab("inactive", "Inativos", "/app/clientes?status=inactive")}
        {tab("archived", "Arquivados", "/app/clientes?status=archived")}
      </nav>

      {progressView ? (
        byClient.size === 0 ? <Panel><EmptyState icon={<Building2 />} title="Nenhum cliente ativo" /></Panel> : (
          <div className="grid gap-4 lg:grid-cols-2">
            {[...byClient.entries()].map(([id, e]) => (
              <Panel key={id} title={<Link href={`/app/clientes/${id}`} className="hover:underline">{e.rows[0].client_name}</Link>}
                actions={<span className="text-xs text-muted">{e.published} publicados</span>}>
                <Progress value={e.produced} max={e.target} label="Aprovados sobre a meta mensal" />
                <ul className="mt-3 space-y-1.5">
                  {e.rows.map((r) => (
                    <li key={r.service_id ?? "none"} className="grid grid-cols-[1fr_auto] items-center gap-3 text-[13px]">
                      <ServiceDot color={r.service_color} name={r.service_name} />
                      <span className="tabular text-xs text-muted">{r.planned} planejados · {r.approved} aprovados{r.service_target ? ` · meta ${r.service_target}` : ""}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        )
      ) : (
        <Panel padded={false}>
          {(clients ?? []).length === 0 ? (
            <EmptyState icon={<Building2 />} title={status === "active" ? "Nenhum cliente cadastrado" : "Nada por aqui"}
              description={status === "active" ? "Cadastre o primeiro cliente para começar a planejar conteúdos." : undefined}
              action={status === "active" && ctx.can("clients.manage") && <ButtonLink href="/app/clientes/novo" variant="primary"><Plus /> Cadastrar cliente</ButtonLink>} />
          ) : (
            <Table>
              <thead><tr><th>Cliente</th><th className="hidden md:table-cell">Segmento</th><th className="hidden sm:table-cell">Subdivisões</th><th>Meta do mês</th><th className="hidden lg:table-cell">Equipe</th></tr></thead>
              <tbody>
                {(clients ?? []).map((c) => {
                  const e = byClient.get(c.id as string);
                  const svc = (c.client_services as unknown as Array<{ count: number }>)[0]?.count ?? 0;
                  const team = (c.client_members as unknown as Array<{ count: number }>)[0]?.count ?? 0;
                  return (
                    <tr key={c.id as string}>
                      <td>
                        <Link href={`/app/clientes/${c.id}`} className="font-medium hover:underline">{c.name as string}</Link>
                        {c.is_sensitive && <Badge tone="warning" className="ml-2">Sensível</Badge>}
                        {c.company_name && <p className="text-xs text-muted">{c.company_name as string}</p>}
                      </td>
                      <td className="hidden text-muted md:table-cell">{(c.segment as string) ?? "—"}</td>
                      <td className="tabular hidden sm:table-cell">{svc}</td>
                      <td className="min-w-44"><Progress value={e?.produced ?? 0} max={e?.target ?? (c.monthly_target as number)} label="Meta do mês" /></td>
                      <td className="tabular hidden text-muted lg:table-cell">{team}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Panel>
      )}
    </>
  );
}
