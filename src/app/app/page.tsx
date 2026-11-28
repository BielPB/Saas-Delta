import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle } from "lucide-react";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listMembers } from "@/lib/data";
import { formatDate, formatDateTime, fromLocalInput, toLocalInput, relative } from "@/lib/format";
import { Avatar, Panel } from "@/components/ui/primitives";
import { Web3Bento } from "@/components/ui/web3-bento";
import { ToggleGroup, ToggleLink } from "@/components/ui/toggle-links";

export const metadata: Metadata = { title: "Visão geral" };

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

const shiftMonth = (ym: string, d: number) => { const x = new Date(`${ym}-15T12:00:00`); x.setMonth(x.getMonth() + d); return x.toISOString().slice(0, 7); };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await getContext();
  const raw = await searchParams;
  const sb = await createClient();
  const ws = ctx.workspace.id;
  const tz = ctx.workspace.timezone;
  const today = toLocalInput(new Date().toISOString(), tz).slice(0, 10);
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw.mes ?? "") ? raw.mes : today.slice(0, 7);
  const startOfMonth = (period: string) => fromLocalInput(`${period}-01T00:00`, tz)!;
  const m0 = startOfMonth(ym); const m1 = startOfMonth(shiftMonth(ym, 1));
  const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(new Date(`${ym}-15T12:00:00`));
  const MonthName = monthName.charAt(0).toUpperCase() + monthName.slice(1);

  const [{ data: prog }, { data: a }, members, onboarding, { data: approvals }, { count: activeClients }, { data: previousApprovals }] = await Promise.all([
    sb.rpc("client_progress", { p_ws: ws, p_month: `${ym}-01`, p_client: null }),
    sb.rpc("dashboard_attention", { p_ws: ws }),
    listMembers(ws),
    onboardingState(ws),
    sb.from("approval_responses").select("content_id, created_at").eq("workspace_id", ws).eq("decision", "approved").gte("created_at", m0).lt("created_at", m1).order("created_at").limit(5000),
    sb.from("clients").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "active"),
    sb.from("approval_responses").select("content_id, created_at").eq("workspace_id", ws).eq("decision", "approved").gte("created_at", startOfMonth(shiftMonth(ym, -1))).lt("created_at", m0).order("created_at").limit(5000),
  ]);
  const att = a as Attention | null;

  // Goal: approved posts (incl. scheduled/published) per client vs. the month's target.
  const perClient = new Map<string, { name: string; target: number; approved: number; planned: number }>();
  for (const r of (prog ?? []) as Array<{ client_id: string; client_name: string; client_target: number; approved: number; planned: number }>) {
    const e = perClient.get(r.client_id) ?? { name: r.client_name, target: Number(r.client_target) || 0, approved: 0, planned: 0 };
    e.planned += Number(r.planned);
    e.approved += Number(r.approved);
    perClient.set(r.client_id, e);
  }
  const target = [...perClient.values()].reduce((n, c) => n + c.target, 0);
  const delivered = [...perClient.values()].reduce((n, c) => n + Math.min(c.approved, c.target), 0);
  const missing = [...perClient.entries()].filter(([, c]) => c.target > c.approved).map(([id, c]) => ({ id, ...c, left: c.target - c.approved }))
    .sort((x, y) => y.left - x.left);


  // Team rhythm: first client approval per post, by day of month.
  function approvalDays(rows: Array<{ content_id: string; created_at: string }>, period: string) {
    const first = new Map<string, string>();
    for (const row of rows) {
      const prev = first.get(row.content_id);
      if (!prev || row.created_at < prev) first.set(row.content_id, row.created_at);
    }
    const dayCount = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)), 0)).getUTCDate();
    const days = Array<number>(dayCount).fill(0);
    for (const date of first.values()) days[Number(toLocalInput(date, tz).slice(8, 10)) - 1]++;
    return { first, days };
  }
  const { first: firstApproval, days: perDay } = approvalDays(approvals ?? [], ym);
  const previous = approvalDays(previousApprovals ?? [], shiftMonth(ym, -1)).days;
  const elapsed = ym < today.slice(0, 7) ? perDay.length : ym > today.slice(0, 7) ? 0 : Number(today.slice(8));

  // Top members: approved posts this month where the person is responsible or editor.
  const approvedIds = [...firstApproval.keys()];
  const [{ data: ass }, { data: eds }] = approvedIds.length ? await Promise.all([
    sb.from("content_assignees").select("content_id, user_id").in("content_id", approvedIds),
    sb.from("content_items").select("id, editor_id").in("id", approvedIds),
  ]) : [{ data: [] }, { data: [] }];
  const credit = new Map<string, Set<string>>();
  const give = (u: string | null, c: string) => { if (!u) return; credit.set(u, (credit.get(u) ?? new Set()).add(c)); };
  for (const x of (ass ?? []) as Array<{ content_id: string; user_id: string }>) give(x.user_id, x.content_id);
  for (const x of (eds ?? []) as Array<{ id: string; editor_id: string | null }>) give(x.editor_id, x.id);
  const names = new Map(members.map((m) => [m.user_id, m]));
  const byGoal = raw.ranking !== "geral";
  const active = members.filter((m) => m.status === "active" && m.user_id);
  const withGoal = active.filter((m) => (m.monthly_target ?? 0) > 0);
  const ranking = byGoal
    ? withGoal.map((m) => { const n = credit.get(m.user_id)?.size ?? 0; return { u: m.user_id, n, pct: Math.round((n / m.monthly_target!) * 100), name: m.full_name, avatar: m.avatar_url }; })
        .sort((x, y) => y.pct - x.pct).slice(0, 6)
    : [...credit.entries()].map(([u, set]) => ({ u, n: set.size, pct: 0, name: names.get(u)?.full_name ?? "Ex-colaborador", avatar: names.get(u)?.avatar_url ?? null }))
        .sort((x, y) => y.n - x.n).slice(0, 6);
  const top = byGoal ? Math.max(100, ...ranking.map((r) => r.pct)) : ranking[0]?.n ?? 0;
  const noGoal = active.length - withGoal.length;

  const attentionItems = att ? [
    { key: "rejected", label: "Em ajuste (pedido do cliente)", items: att.rejected_contents.map((c) => ({ href: `/app/conteudos/${c.id}`, text: `#${c.code} ${c.title}` })) },
    { key: "stale", label: "Aprovações paradas", items: att.stale_approvals.map((c) => ({ href: `/app/conteudos/${c.id}`, text: `#${c.code} ${c.title}`, meta: `enviado ${relative(c.sent_at)}` })) },
    { key: "soon", label: "Publicação próxima sem aprovação", items: att.unapproved_soon.map((c) => ({ href: `/app/conteudos/${c.id}`, text: `#${c.code} ${c.title}`, meta: formatDateTime(c.at) })) },
    { key: "late", label: "Publicações atrasadas", items: att.late_publications.map((c) => ({ href: `/app/conteudos/${c.id}`, text: `#${c.code} ${c.title}`, meta: formatDate(c.at) })) },
    { key: "unconfirmed", label: "Agendados sem confirmação", items: att.unconfirmed_published.map((c) => ({ href: `/app/conteudos/${c.id}`, text: `#${c.code} ${c.title}`, meta: formatDateTime(c.at) })) },
  ].filter((x) => x.items.length > 0) : [];

  const hour = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: ctx.workspace.timezone }).format(new Date()));
  const hello = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const displayName = ctx.profile.full_name;
  const clientTotals = Array.from(perClient, ([id, c]) => ({ id, ...c })).sort((a,b) => b.planned - a.planned || a.name.localeCompare(b.name));
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Mês" className="flex items-center rounded-full border border-border bg-surface">
          <Link href={`/app?mes=${shiftMonth(ym, -1)}`} aria-label="Mês anterior" className="flex size-8 items-center justify-center rounded-full text-muted hover:text-fg pointer-coarse:size-10"><ChevronLeft className="size-4" /></Link>
          <span className="min-w-28 text-center text-[13px] font-semibold">{MonthName} {ym.slice(0, 4)}</span>
          <Link href={`/app?mes=${shiftMonth(ym, 1)}`} aria-label="Próximo mês" className="flex size-8 items-center justify-center rounded-full text-muted hover:text-fg pointer-coarse:size-10"><ChevronRight className="size-4" /></Link>
        </nav>
      </div>

      <Web3Bento greeting={hello} name={displayName} month={MonthName} period={ym} days={perDay} previous={previous}
        elapsed={elapsed} clients={clientTotals} activeClients={activeClients ?? 0} target={target} delivered={delivered}
        approved={clientTotals.reduce((sum,c) => sum+c.approved,0)} planned={clientTotals.reduce((sum,c) => sum+c.planned,0)} pendingContents={new Set(attentionItems.flatMap(group => group.items.map(item => item.href))).size} />

      <div className="mb-4">
        <Panel className="dashboard-detail" title="Desempenho da equipe" actions={
          <ToggleGroup active={byGoal ? "meta" : "geral"} aria-label="Tipo de ranking" className="flex rounded-full border border-border p-0.5 text-[11px] font-semibold">
            <ToggleLink value="meta" href={`/app?mes=${ym}`} scroll={false} className="rounded-full px-2.5 py-0.5 text-muted pointer-coarse:py-1.5" activeClassName="bg-accent text-accent-fg" title="% da meta individual de cada pessoa">Meta individual</ToggleLink>
            <ToggleLink value="geral" href={`/app?mes=${ym}&ranking=geral`} scroll={false} className="rounded-full px-2.5 py-0.5 text-muted pointer-coarse:py-1.5" activeClassName="bg-accent text-accent-fg" title="Quantidade de posts aprovados">Geral</ToggleLink>
          </ToggleGroup>}>
          {ranking.length === 0 ? (
            <p className="text-[13px] text-muted">{byGoal ? <>Defina a meta mensal de cada pessoa em <Link href="/app/colaboradores" className="underline">Equipe</Link> para ver o ranking por meta.</> : "Aparece quando os posts com responsável ou editor forem aprovados."}</p>
          ) : (
            <ol className="space-y-3">
              {ranking.map((r, i) => (
                <li key={r.u} className="flex items-center gap-3">
                  <span className="tabular w-4 text-xs text-subtle">{i + 1}</span>
                  <Avatar name={r.name} src={r.avatar} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="flex justify-between text-[13px]"><span className="wrap-anywhere whitespace-normal font-medium">{r.name}</span><span className="tabular text-muted">{byGoal ? `${r.pct}%` : r.n}</span></p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-accent" style={{ width: `${top ? ((byGoal ? r.pct : r.n) / top) * 100 : 0}%` }} /></div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {byGoal && ranking.length > 0 && noGoal > 0 && <p className="mt-3 text-xs text-muted">{noGoal} pessoa(s) sem meta individual não entram neste ranking. Defina em Equipe.</p>}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section id="falta" aria-labelledby="falta-t" className="dashboard-detail rounded-xl border border-border bg-surface">
          <h2 id="falta-t" className="border-b border-border px-4 py-3 text-[13px] font-semibold">O que falta para a meta <span className="font-normal text-muted">· por cliente</span></h2>
          {missing.length === 0 ? <p className="px-4 py-4 text-[13px] text-muted">{target ? "Todos os clientes bateram a meta do mês." : "Nenhuma meta definida."}</p> : (
            <ul className="divide-y divide-border">
              {missing.map((m) => (
                <li key={m.id}><Link href={`/app/clientes/${m.id}?aba=posts&mes=${ym}`} className="flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-surface-2">
                  <span className="min-w-0 flex-1 wrap-anywhere whitespace-normal font-medium">{m.name}</span>
                  <span className="tabular text-xs text-muted">{m.approved} de {m.target}</span>
                  <span className="tabular rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold">faltam {m.left}</span>
                </Link></li>
              ))}
            </ul>
          )}
        </section>
        <section id="atencao" aria-labelledby="atencao-t" className="dashboard-detail rounded-xl border border-border bg-surface">
          <h2 id="atencao-t" className="border-b border-border px-4 py-3 text-[13px] font-semibold">Precisa de atenção</h2>
          {attentionItems.length === 0 ? <p className="px-4 py-4 text-[13px] text-muted">Nada travado agora.</p> : (
            <div className="divide-y divide-border">
              {attentionItems.map((g) => (
                <div key={g.key} className="px-4 py-3">
                  <p className="mb-1 text-xs font-semibold text-muted">{g.label} <span className="tabular font-normal">{g.items.length}</span></p>
                  <ul className="space-y-0.5">
                    {g.items.slice(0, 4).map((it, i) => (
                      <li key={i}><Link href={it.href} className="flex justify-between gap-2 text-[13px] hover:underline"><span className="wrap-anywhere whitespace-normal">{it.text}</span>{(it as { meta?: string }).meta && <span className="shrink-0 text-xs text-muted">{(it as { meta?: string }).meta}</span>}</Link></li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <div className="mt-4">
      {onboarding.pending.length > 0 && ctx.can("workspace.manage") && (
        <Panel className="dashboard-detail mb-5" title={`Primeiros passos · ${onboarding.done} de ${onboarding.total}`}>
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
      </div>
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
    { label: "Definir a meta dos clientes", done: (targets.count ?? 0) > 0, href: "/app/clientes" },
    { label: "Conectar Google Drive", done: (drive.count ?? 0) > 0, href: "/app/integracoes" },
    { label: "Criar o primeiro post", done: (contents.count ?? 0) > 0, href: "/app/clientes" },
    { label: "Configurar pipeline e templates", done: (contents.count ?? 0) > 0, href: "/app/configuracoes?aba=templates" },
  ];
  const done = steps.filter((x) => x.done).length;
  return { steps, done, total: steps.length, pending: skipped ? [] : steps.filter((x) => !x.done) };
}
