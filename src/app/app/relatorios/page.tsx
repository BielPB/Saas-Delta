import type { Metadata } from "next";
import { Download } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, Panel, Progress, Table, Stat } from "@/components/ui/primitives";
import { BarList } from "@/components/charts";

export const metadata: Metadata = { title: "Relatórios" };

function range(sp: { de?: string; ate?: string }) {
  const now = new Date();
  const de = /^\d{4}-\d{2}-\d{2}$/.test(sp.de ?? "") ? sp.de! : new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(sp.ate ?? "") ? sp.ate! : new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { de, ate, from: `${de}T00:00:00-03:00`, to: new Date(new Date(`${ate}T00:00:00-03:00`).getTime() + 864e5).toISOString() };
}

interface ClientRep { client_id: string; client_name: string; contracted: number; produced: number; approved: number; published: number; target_pct: number | null; adjustments: number; avg_approval_hours: number | null; by_service: Record<string, number>; by_format: Record<string, number> }
interface MemberRep { user_id: string; full_name: string; assigned: number; done: number; overdue: number; in_progress: number; avg_completion_hours: number | null; adjustments: number; open_load: number }
interface AgencyRep { contents: number; approved: number; published: number; first_pass_rate: number | null; avg_planning_to_approval_hours: number | null; avg_approval_to_publication_hours: number | null; adjustments: number;
  bottlenecks: Array<{ step: string; open: number; overdue: number; avg_hours: number | null }>; by_format: Record<string, number> }

const stepLabel: Record<string, string> = { script: "Roteiro", capture: "Captação", edit: "Edição", cover: "Capa", caption: "Legenda", design: "Design", review: "Revisão interna", general: "Gerais", adjust_caption: "Ajuste de legenda", adjust_video: "Ajuste de vídeo", adjust_cover: "Ajuste de capa", adjust_image: "Ajuste de arte", adjust_carousel: "Ajuste de carrossel" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string }> }) {
  const ctx = await requirePermission("reports.view");
  const r = range(await searchParams);
  const sb = await createClient();
  const args = { p_ws: ctx.workspace.id, p_from: r.from, p_to: r.to };
  const [{ data: clients }, { data: members }, { data: agency }] = await Promise.all([
    sb.rpc("report_clients", args), sb.rpc("report_members", args), sb.rpc("report_agency", args),
  ]);
  const a = agency as AgencyRep | null;
  const exportHref = (kind: string) => `/api/relatorios/${kind}?de=${r.de}&ate=${r.ate}`;

  return (
    <>
      <PageHeader title="Relatórios" description="Indicadores contam conteúdos (não entregáveis). Período pela data de referência do conteúdo: postagem prevista, senão prazo, senão criação."
        actions={<form className="flex flex-wrap items-end gap-2" action="/app/relatorios">
          <label className="text-xs text-muted">De<input name="de" type="date" defaultValue={r.de} className="mt-1 block h-8 rounded-md border border-border bg-surface px-2 text-[13px] text-fg" /></label>
          <label className="text-xs text-muted">Até<input name="ate" type="date" defaultValue={r.ate} className="mt-1 block h-8 rounded-md border border-border bg-surface px-2 text-[13px] text-fg" /></label>
          <button className="h-8 rounded-md border border-border px-3 text-[13px] hover:bg-surface-2" type="submit">Aplicar</button>
        </form>} />

      {a && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <Stat label="Conteúdos" value={a.contents} />
          <Stat label="Aprovados" value={a.approved} />
          <Stat label="Publicados" value={a.published} />
          <Stat label="Aprovação na 1ª versão" value={a.first_pass_rate == null ? "—" : `${a.first_pass_rate}%`} />
          <Stat label="Planejamento → aprovação" value={a.avg_planning_to_approval_hours == null ? "—" : `${a.avg_planning_to_approval_hours}h`} />
          <Stat label="Aprovação → publicação" value={a.avg_approval_to_publication_hours == null ? "—" : `${a.avg_approval_to_publication_hours}h`} />
          <Stat label="Solicitações de ajuste" value={a.adjustments} />
        </div>
      )}

      <Panel className="mt-4" title="Por cliente" padded={false} actions={<ButtonLink size="sm" href={exportHref("clientes")} prefetch={false}><Download /> CSV</ButtonLink>}>
        <Table>
          <thead><tr><th>Cliente</th><th className="text-right">Contratados</th><th className="text-right">Produzidos</th><th className="text-right">Aprovados</th><th className="text-right">Publicados</th><th>Meta</th><th className="text-right">Ajustes</th><th className="text-right">Tempo de aprovação</th></tr></thead>
          <tbody>
            {((clients ?? []) as ClientRep[]).map((c) => (
              <tr key={c.client_id}>
                <td className="font-medium">{c.client_name}</td>
                <td className="tabular text-right">{c.contracted}</td><td className="tabular text-right">{c.produced}</td>
                <td className="tabular text-right">{c.approved}</td><td className="tabular text-right">{c.published}</td>
                <td className="min-w-36"><Progress value={Number(c.approved)} max={Number(c.contracted)} label="Cumprimento da meta" /></td>
                <td className="tabular text-right">{c.adjustments}</td>
                <td className="tabular text-right">{c.avg_approval_hours == null ? "—" : `${c.avg_approval_hours}h`}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Gargalos por etapa (tarefas abertas)">
          {a && a.bottlenecks.length ? (
            <BarList label="Tarefas abertas por etapa" data={a.bottlenecks.filter((b) => b.open > 0).slice(0, 10).map((b) => ({ key: b.step, label: `${stepLabel[b.step] ?? b.step}${b.overdue ? ` (${b.overdue} atrasadas)` : ""}`, value: Number(b.open) }))} />
          ) : <p className="text-[13px] text-muted">Sem tarefas abertas.</p>}
        </Panel>
        <Panel title="Distribuição por formato">
          {a && Object.keys(a.by_format).length ? (
            <BarList label="Conteúdos por formato" data={Object.entries(a.by_format).map(([k, v]) => ({ key: k, label: k, value: Number(v) }))} />
          ) : <p className="text-[13px] text-muted">Sem conteúdos no período.</p>}
        </Panel>
      </div>

      <Panel className="mt-4" title="Por colaborador" padded={false} actions={<ButtonLink size="sm" href={exportHref("colaboradores")} prefetch={false}><Download /> CSV</ButtonLink>}>
        <Table>
          <thead><tr><th>Colaborador</th><th className="text-right">Atribuídas</th><th className="text-right">Concluídas</th><th className="text-right">Atrasadas</th><th className="text-right">Em andamento</th><th className="text-right">Tempo médio</th><th className="text-right">Ajustes</th><th className="text-right">Carga aberta</th></tr></thead>
          <tbody>
            {((members ?? []) as MemberRep[]).map((m) => (
              <tr key={m.user_id}>
                <td className="font-medium">{m.full_name}</td>
                <td className="tabular text-right">{m.assigned}</td><td className="tabular text-right">{m.done}</td><td className="tabular text-right">{m.overdue}</td>
                <td className="tabular text-right">{m.in_progress}</td><td className="tabular text-right">{m.avg_completion_hours == null ? "—" : `${m.avg_completion_hours}h`}</td>
                <td className="tabular text-right">{m.adjustments}</td><td className="tabular text-right">{m.open_load}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      <p className="mt-3 text-xs text-muted">Exportação em PDF e Excel está no roadmap; o CSV abre no Excel e no Google Sheets (separador ponto e vírgula, UTF-8).</p>
    </>
  );
}
