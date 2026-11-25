import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CalendarClock, CheckCircle2, Circle, FileWarning, Hourglass, Target, XCircle } from "lucide-react";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listClientsLite, listFormats, listMembers, listServicesLite, parseFilters, qs } from "@/lib/data";
import { stages, stageLabel, type ApprovalStatus, type PublicationStatus } from "@/lib/domain";
import { formatDate, formatDateTime, relative } from "@/lib/format";
import { z } from "zod";
import { EmptyState, PageHeader, Panel, Stat } from "@/components/ui/primitives";
import { BarList, ColumnChart } from "@/components/charts";
import { ApprovalBadge, PublicationBadge } from "@/components/content/badges";
import { DashboardFilters } from "./dashboard-filters";
import { activityText } from "@/lib/activity";

export const metadata: Metadata = { title: "Visão geral" };

const filters = z.object({
  periodo: z.enum(["mes", "mes_anterior", "30d", "90d", "trimestre"]).optional().catch(undefined),
  cliente: z.string().uuid().optional().catch(undefined),
  servico: z.string().uuid().optional().catch(undefined),
  formato: z.string().uuid().optional().catch(undefined),
  colaborador: z.string().uuid().optional().catch(undefined),
});

function period(p?: string) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (p) {
    case "mes_anterior": return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1), label: "Mês anterior" };
    case "30d": return { from: new Date(now.getTime() - 30 * 864e5), to: new Date(now.getTime() + 864e5), label: "Últimos 30 dias" };
    case "90d": return { from: new Date(now.getTime() - 90 * 864e5), to: new Date(now.getTime() + 864e5), label: "Últimos 90 dias" };
    case "trimestre": { const q = Math.floor(m / 3) * 3; return { from: new Date(y, q, 1), to: new Date(y, q + 3, 1), label: "Trimestre" }; }
    default: return { from: new Date(y, m, 1), to: new Date(y, m + 1, 1), label: "Este mês" };
  }
}

interface Summary {
  active_clients: number; planned: number; in_production: number; awaiting_edit: number; internal_review: number;
  awaiting_approval: number; approved: number; scheduled: number; published: number; rejected: number;
  tasks_overdue: number; tasks_done: number; by_stage: Record<string, number>;
  by_member: Array<{ user_id: string; name: string; open: number; overdue: number }>;
  first_pass_rate: number | null; avg_approval_hours: number | null;
  top_pending_clients: Array<{ client_id: string; name: string; pending: number }>;
  monthly: Array<{ month: string; planned: number; approved: number; published: number }>;
  upcoming: Array<{ id: string; code: number; title: string; client: string; at: string; publication_status: PublicationStatus; approval_status: ApprovalStatus }>;
}
interface Attention {
  overdue_tasks: Array<{ id: string; title: string; due_at: string }>;
  rejected_contents: Array<{ id: string; code: number; title: string }>;
  stale_approvals: Array<{ id: string; code: number; title: string; sent_at: string }>;
  unapproved_soon: Array<{ id: string; code: number; title: string; at: string }>;
  missing_files: Array<{ id: string; name: string }>;
  unconfirmed_published: Array<{ id: string; code: number; title: string; at: string }>;
  late_publications: Array<{ id: string; code: number; title: string; at: string }>;
  clients_below_target: Array<{ client_id: string; name: string; target: number; produced: number; expected: number }>;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await getContext();
  const f = parseFilters(filters, await searchParams);
  const pr = period(f.periodo);
  const sb = await createClient();
  const ws = ctx.workspace.id;

  const [{ data: s }, { data: a }, clients, services, formats, members, { data: activity }, onboarding] = await Promise.all([
    sb.rpc("dashboard_summary", {
      p_ws: ws, p_from: pr.from.toISOString(), p_to: pr.to.toISOString(),
      p_client: f.cliente ?? null, p_service: f.servico ?? null, p_format: f.formato ?? null, p_member: f.colaborador ?? null,
    }),
    sb.rpc("dashboard_attention", { p_ws: ws }),
    listClientsLite(ws), listServicesLite(ws), listFormats(ws), listMembers(ws),
    sb.from("activity_logs").select("id, action, actor_type, actor_label, actor_id, data, created_at, content_id, entity_type")
      .eq("workspace_id", ws).order("created_at", { ascending: false }).limit(10),
    onboardingState(ws),
  ]);
  const sum = s as Summary | null;
  const att = a as Attention | null;
  const names = new Map(members.map((m) => [m.user_id, m.full_name]));
  const base = { cliente: f.cliente, servico: f.servico, formato: f.formato, responsavel: f.colaborador };
  const link = (patch: Record<string, string>) => `/app/conteudos${qs(base, patch)}`;

  const attentionItems = att ? [
    { key: "overdue", icon: <Hourglass />, label: "Tarefas vencidas", items: att.overdue_tasks.map((t) => ({ href: `/app/tarefas/${t.id}`, text: t.title, meta: relative(t.due_at) })), more: "/app/tarefas?situacao=atrasadas" },
    { key: "rejected", icon: <XCircle />, label: "Conteúdos reprovados", items: att.rejected_contents.map((c) => ({ href: `/app/conteudos/${c.id}`, text: `#${c.code} ${c.title}` })), more: link({ aprovacao: "rejected" }) },
    { key: "stale", icon: <CalendarClock />, label: "Aprovações paradas", items: att.stale_approvals.map((c) => ({ href: `/app/conteudos/${c.id}`, text: `#${c.code} ${c.title}`, meta: `enviado ${relative(c.sent_at)}` })), more: link({ aprovacao: "awaiting" }) },
    { key: "soon", icon: <AlertTriangle />, label: "Publicação próxima sem aprovação", items: att.unapproved_soon.map((c) => ({ href: `/app/conteudos/${c.id}`, text: `#${c.code} ${c.title}`, meta: formatDateTime(c.at) })), more: "/app/calendario" },
    { key: "unconfirmed", icon: <Circle />, label: "Agendados sem confirmação", items: att.unconfirmed_published.map((c) => ({ href: `/app/conteudos/${c.id}`, text: `#${c.code} ${c.title}`, meta: formatDateTime(c.at) })), more: link({ publicacao: "scheduled" }) },
    { key: "late", icon: <CalendarClock />, label: "Publicações atrasadas", items: att.late_publications.map((c) => ({ href: `/app/conteudos/${c.id}`, text: `#${c.code} ${c.title}`, meta: formatDate(c.at) })), more: link({ publicacao: "late" }) },
    { key: "files", icon: <FileWarning />, label: "Arquivos não encontrados", items: att.missing_files.map((x) => ({ href: `/app/arquivos?arquivo=${x.id}`, text: x.name })), more: "/app/arquivos?status=missing" },
    { key: "target", icon: <Target />, label: "Clientes abaixo da meta", items: att.clients_below_target.map((c) => ({ href: `/app/clientes/${c.client_id}`, text: c.name, meta: `${c.produced} de ${c.expected} esperados` })), more: "/app/clientes?visao=progresso" },
  ].filter((x) => x.items.length > 0) : [];

  const monthLabel = (m: string) => new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(new Date(`${m}-15`)).replace(".", "");

  return (
    <>
      <PageHeader title="Visão geral" description={`${ctx.workspace.name} · ${pr.label}`}
        actions={<DashboardFilters clients={clients} services={services} formats={formats}
          members={members.filter((m) => m.status === "active").map((m) => ({ id: m.user_id, name: m.full_name }))} />} />

      {onboarding.pending.length > 0 && ctx.can("workspace.manage") && (
        <Panel className="mb-5" title={`Primeiros passos · ${onboarding.done} de ${onboarding.total}`}>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {onboarding.steps.map((st) => (
              <li key={st.label}>
                <Link href={st.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                  {st.done ? <CheckCircle2 className="size-4 text-[var(--tone-success-fg)]" aria-label="Concluído" /> : <Circle className="size-4 text-subtle" aria-label="Pendente" />}
                  <span className={st.done ? "text-muted line-through" : ""}>{st.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {!sum ? (
        <EmptyState title="Não foi possível carregar os indicadores" description="Recarregue a página." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Clientes ativos" value={sum.active_clients} href="/app/clientes" />
            <Stat label="Planejados" value={sum.planned} href={link({})} />
            <Stat label="Em produção" value={sum.in_production} href={link({ producao: "in_production" })} tone="progress" />
            <Stat label="Aguardando edição" value={sum.awaiting_edit} href={link({ etapa: "editing" })} />
            <Stat label="Aguardando aprovação" value={sum.awaiting_approval} href={link({ aprovacao: "awaiting" })} tone="info" />
            <Stat label="Reprovados / ajustes" value={sum.rejected} href={link({ aprovacao: "rejected" })} tone="danger" />
            <Stat label="Aprovados" value={sum.approved} href={link({ aprovacao: "approved" })} tone="success" />
            <Stat label="Agendados" value={sum.scheduled} href={link({ publicacao: "scheduled" })} />
            <Stat label="Publicados" value={sum.published} href={link({ publicacao: "published" })} tone="success" />
            <Stat label="Tarefas atrasadas" value={sum.tasks_overdue} href="/app/tarefas?situacao=atrasadas" tone={sum.tasks_overdue ? "danger" : undefined} />
            <Stat label="Tarefas concluídas" value={sum.tasks_done} hint="no período" href="/app/tarefas?status=done" />
            <Stat label="Aprovação na 1ª versão" value={sum.first_pass_rate == null ? "—" : `${sum.first_pass_rate}%`}
              hint={sum.avg_approval_hours == null ? "tempo médio —" : `tempo médio ${sum.avg_approval_hours}h`} />
          </div>

          {attentionItems.length > 0 && (
            <section aria-labelledby="atencao" className="mt-5">
              <h2 id="atencao" className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
                <span className="size-2 rounded-full bg-[var(--tone-danger-fg)]" aria-hidden /> Atenção prioritária
              </h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {attentionItems.map((g) => (
                  <div key={g.key} className="rounded-lg border border-border bg-surface">
                    <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[13px] font-medium [&_svg]:size-4 [&_svg]:text-muted">
                      <span className="flex items-center gap-2">{g.icon}{g.label}</span>
                      <Link href={g.more} className="tabular text-xs text-muted hover:text-fg">{g.items.length}{g.items.length >= 10 ? "+" : ""} <ArrowUpRight className="inline size-3" /></Link>
                    </div>
                    <ul className="divide-y divide-border">
                      {g.items.slice(0, 4).map((it) => (
                        <li key={it.href + it.text}>
                          <Link href={it.href} className="flex items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-2">
                            <span className="min-w-0 flex-1 truncate">{it.text}</span>
                            {"meta" in it && it.meta ? <span className="shrink-0 text-xs text-muted">{String(it.meta)}</span> : null}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <Panel title="Produção mensal (conteúdos planejados)" className="lg:col-span-2">
              <ColumnChart label="Conteúdos planejados por mês"
                data={sum.monthly.map((m) => ({ label: monthLabel(m.month), value: m.planned, detail: `${m.approved} aprovados · ${m.published} publicados` }))} />
            </Panel>
            <Panel title="Distribuição por etapa">
              <BarList label="Conteúdos por etapa"
                data={stages.filter((st) => (sum.by_stage[st.key] ?? 0) > 0).map((st) => ({ key: st.key, label: stageLabel[st.key], value: sum.by_stage[st.key] ?? 0 }))}
                hrefFor={(k) => link({ etapa: k })} />
              {Object.keys(sum.by_stage).length === 0 && <EmptyState compact title="Sem conteúdos no período" />}
            </Panel>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Panel title="Próximas publicações" padded={false}>
              {sum.upcoming.length === 0 ? <EmptyState compact title="Nada programado" description="Defina datas no calendário editorial." /> : (
                <ul className="divide-y divide-border">
                  {sum.upcoming.map((u) => (
                    <li key={u.id}>
                      <Link href={`/app/conteudos/${u.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-surface-2">
                        <div className="w-14 shrink-0 text-xs text-muted">{formatDate(u.at)}</div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium">#{u.code} {u.title}</p>
                          <p className="truncate text-xs text-muted">{u.client}</p>
                        </div>
                        {u.approval_status === "approved" ? <PublicationBadge c={{ publication_status: u.publication_status, planned_publish_at: u.at, scheduled_at: null }} /> : <ApprovalBadge s={u.approval_status} />}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Tarefas abertas por colaborador">
              {sum.by_member.length === 0 ? <EmptyState compact title="Nenhuma tarefa atribuída" /> : (
                <BarList label="Tarefas abertas por colaborador" data={sum.by_member.slice(0, 8).map((m) => ({ key: m.user_id, label: m.name, value: m.open }))}
                  hrefFor={(k) => `/app/tarefas?responsavel=${k}`} />
              )}
            </Panel>
            <Panel title="Clientes com mais pendências">
              {sum.top_pending_clients.length === 0 ? <EmptyState compact title="Sem pendências" /> : (
                <BarList label="Pendências por cliente" data={sum.top_pending_clients.map((c) => ({ key: c.client_id, label: c.name, value: c.pending }))}
                  hrefFor={(k) => `/app/clientes/${k}`} />
              )}
            </Panel>
          </div>

          <Panel className="mt-4" title="Atividades recentes" actions={<Link href="/app/atividade" className="text-xs text-muted hover:text-fg">Ver tudo</Link>} padded={false}>
            {(activity ?? []).length === 0 ? <EmptyState compact title="Nenhuma atividade ainda" /> : (
              <ul className="divide-y divide-border">
                {(activity ?? []).map((ev) => (
                  <li key={ev.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{ev.actor_type === "client" ? String(ev.actor_label ?? "Cliente") : names.get(ev.actor_id as string) ?? "Sistema"}</span>{" "}
                      <span className="text-muted">{activityText(ev.action as string, ev.data as Record<string, unknown>)}</span>
                    </span>
                    {ev.content_id ? <Link href={`/app/conteudos/${String(ev.content_id)}`} className="shrink-0 text-xs text-muted hover:text-fg">abrir</Link> : null}
                    <time className="shrink-0 text-xs text-subtle" dateTime={ev.created_at as string}>{relative(ev.created_at as string)}</time>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

async function onboardingState(ws: string) {
  const sb = await createClient();
  const [w, members, clients, services, targets, drive, contents] = await Promise.all([
    sb.from("workspaces").select("logo_path, onboarding").eq("id", ws).single(),
    sb.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
    sb.from("clients").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
    sb.from("client_services").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
    sb.from("monthly_targets").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
    sb.from("drive_connections").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
    sb.from("content_items").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
  ]);
  const skipped = ((w.data?.onboarding as { dismissed?: boolean } | null)?.dismissed) ?? false;
  const steps = [
    { label: "Workspace criado", done: true, href: "/app/configuracoes" },
    { label: "Identidade visual", done: Boolean(w.data?.logo_path), href: "/app/configuracoes" },
    { label: "Convidar colaboradores", done: (members.count ?? 0) > 1, href: "/app/colaboradores" },
    { label: "Revisar funções e permissões", done: (members.count ?? 0) > 1, href: "/app/configuracoes?aba=funcoes" },
    { label: "Cadastrar clientes", done: (clients.count ?? 0) > 0, href: "/app/clientes/novo" },
    { label: "Cadastrar subdivisões", done: (services.count ?? 0) > 0, href: "/app/clientes" },
    { label: "Configurar metas mensais", done: (targets.count ?? 0) > 0, href: "/app/clientes" },
    { label: "Conectar Google Drive", done: (drive.count ?? 0) > 0, href: "/app/integracoes" },
    { label: "Criar o primeiro conteúdo", done: (contents.count ?? 0) > 0, href: "/app/conteudos/novo" },
    { label: "Configurar pipeline e templates", done: (contents.count ?? 0) > 0, href: "/app/configuracoes?aba=templates" },
  ];
  const done = steps.filter((x) => x.done).length;
  return { steps, done, total: steps.length, pending: skipped ? [] : steps.filter((x) => !x.done) };
}
