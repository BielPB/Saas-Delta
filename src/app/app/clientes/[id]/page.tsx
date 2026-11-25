import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Check, Film, Plus, Stamp } from "lucide-react";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { contentSelect, listFormats, listMembers, memberMap, signPaths, taskSelect, thumbnails, assetSelect, type AssetRow, type ContentRow, type TaskRow } from "@/lib/data";
import { formatDateTime, monthStart, relative, bytes } from "@/lib/format";
import { cn, isUuid } from "@/lib/utils";
import { subdivisionText } from "@/lib/labels";
import { activityText } from "@/lib/activity";
import { ButtonLink } from "@/components/ui/button";
import { Avatar, Badge, EmptyState, PageHeader, Panel, Progress, Table } from "@/components/ui/primitives";
import { LinkTabs } from "@/components/ui/tabs";
import { ContentTable } from "@/components/content/content-table";
import { ServiceDot } from "@/components/content/badges";
import { TaskList } from "@/components/tasks/task-list";
import { ClientForm } from "../client-form";
import { ClientStatusActions, ClientTeam, ServicesManager, TargetsManager } from "./client-panels";

export const metadata: Metadata = { title: "Cliente" };

const TABS = ["visao", "conteudos", "servicos", "calendario", "tarefas", "aprovacoes", "arquivos", "historico", "configuracoes"] as const;

interface Progress {
  service_id: string | null; service_name: string; service_color: string; service_target: number | null; client_target: number;
  planned: number; videos_ready: number; covers_ready: number; captions_ready: number; approved: number; scheduled: number; published: number;
}

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string; mes?: string; novo?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const ctx = await getContext();
  const sb = await createClient();
  const { data: client } = await sb.from("clients").select("*").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!client) notFound(); // RLS: not allocated => invisible => 404 (no existence leak)

  const tab = (TABS as readonly string[]).includes(sp.aba ?? "") ? (sp.aba as (typeof TABS)[number]) : "visao";
  const month = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? `${sp.mes}-01` : monthStart();
  const canManage = ctx.can("clients.manage");

  const [{ data: services }, { count: contentCount }, { count: taskCount }] = await Promise.all([
    sb.from("client_services").select("*").eq("client_id", id).order("name"),
    sb.from("content_items").select("id", { count: "exact", head: true }).eq("client_id", id).is("archived_at", null),
    sb.from("tasks").select("id", { count: "exact", head: true }).eq("client_id", id).not("status", "in", "(done,cancelled)"),
  ]);

  const tabs = [
    { key: "visao", label: "Visão geral" }, { key: "conteudos", label: "Conteúdos", count: contentCount ?? 0 },
    { key: "servicos", label: "Subdivisões", count: (services ?? []).length }, { key: "calendario", label: "Calendário" },
    { key: "tarefas", label: "Tarefas", count: taskCount ?? 0 }, { key: "aprovacoes", label: "Aprovações" },
    { key: "arquivos", label: "Arquivos" }, { key: "historico", label: "Histórico" }, { key: "configuracoes", label: "Configurações" },
  ];

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/app/clientes" className="hover:text-fg">Clientes</Link>}
        title={<span className="flex items-center gap-2">{client.name}{client.is_sensitive && <Badge tone="warning">Sensível</Badge>}{client.status !== "active" && <Badge>{client.status === "archived" ? "Arquivado" : "Inativo"}</Badge>}</span>}
        description={[client.company_name, client.segment, client.instagram].filter(Boolean).join(" · ") || undefined}
        actions={<>
          {ctx.can("approvals.manage") && <ButtonLink href={`/app/aprovacoes/novo?cliente=${id}`}><Stamp /> Link de aprovação</ButtonLink>}
          {ctx.can("contents.manage") && <ButtonLink href={`/app/conteudos/novo?cliente=${id}`} variant="primary"><Plus /> Novo conteúdo</ButtonLink>}
        </>}
      />
      <LinkTabs tabs={tabs} active={tab} base={`/app/clientes/${id}`} />

      {tab === "visao" && (
        <Overview ws={ctx.workspace.id} client={id} month={month} servicesCount={(services ?? []).length} contentCount={contentCount ?? 0}
          can={{ clients: canManage, contents: ctx.can("contents.manage"), approvals: ctx.can("approvals.manage") }} />
      )}
      {tab === "conteudos" && <ClientContents ws={ctx.workspace.id} client={id} />}
      {tab === "servicos" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <ServicesManager clientId={id} services={(services ?? []) as never} canManage={canManage} created={sp.novo === "1"} />
          <TargetsPanel ws={ctx.workspace.id} client={id} canManage={canManage} services={(services ?? []) as Array<{ id: string; name: string }>} />
        </div>
      )}
      {tab === "calendario" && (
        <Panel>
          <EmptyState icon={<CalendarDays />} title="Calendário editorial do cliente"
            description="O calendário completo, com arrastar e soltar, abre filtrado por este cliente."
            action={<ButtonLink href={`/app/calendario?cliente=${id}`} variant="primary">Abrir calendário</ButtonLink>} />
        </Panel>
      )}
      {tab === "tarefas" && <ClientTasks ws={ctx.workspace.id} client={id} me={ctx.user.id} canManage={ctx.can("tasks.manage")} />}
      {tab === "aprovacoes" && <ClientApprovals client={id} />}
      {tab === "arquivos" && <ClientFiles client={id} />}
      {tab === "historico" && <ClientHistory ws={ctx.workspace.id} client={id} />}
      {tab === "configuracoes" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Panel title="Dados cadastrais"><ClientForm initial={client} disabled={!canManage} /></Panel>
          <div className="space-y-4">
            <ClientTeamPanel ws={ctx.workspace.id} client={id} canManage={canManage} />
            {canManage && <Panel title="Status do cliente"><ClientStatusActions id={id} status={client.status} /></Panel>}
          </div>
        </div>
      )}
    </>
  );
}

async function Overview({ ws, client, month, servicesCount, contentCount, can }: {
  ws: string; client: string; month: string; servicesCount: number; contentCount: number;
  can: { clients: boolean; contents: boolean; approvals: boolean };
}) {
  const sb = await createClient();
  const [{ data }, { count: batchCount }, { count: publishedEver }, { count: movedOn }, { data: taskRows }, members] = await Promise.all([
    sb.rpc("client_progress", { p_ws: ws, p_month: month, p_client: client }),
    sb.from("approval_batches").select("id", { count: "exact", head: true }).eq("client_id", client),
    sb.from("content_items").select("id", { count: "exact", head: true }).eq("client_id", client).eq("publication_status", "published"),
    sb.from("content_items").select("id", { count: "exact", head: true }).eq("client_id", client).not("stage", "in", "(planning,cancelled)"),
    sb.from("tasks").select("assignee_id, status, due_at, completed_at").eq("client_id", client).neq("status", "cancelled").limit(3000),
    memberMap(ws),
  ]);
  const rows = (data ?? []) as Progress[];
  const n = (v: number | string) => Number(v);
  const total = rows.reduce((a, r) => ({
    planned: a.planned + n(r.planned), approved: a.approved + n(r.approved), published: a.published + n(r.published), scheduled: a.scheduled + n(r.scheduled),
  }), { planned: 0, approved: 0, published: 0, scheduled: 0 });
  const target = rows[0]?.client_target ?? 0;
  const prev = new Date(`${month}T12:00:00`); prev.setMonth(prev.getMonth() - 1);
  const next = new Date(`${month}T12:00:00`); next.setMonth(next.getMonth() + 1);
  const ym = (d: Date) => d.toISOString().slice(0, 7);
  const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(`${month}T12:00:00`));
  const hasTarget = target > 0 || rows.some((r) => (r.service_target ?? 0) > 0);

  const steps = [
    { done: servicesCount > 0, title: "Cadastre as subdivisões do cliente", text: "São as categorias de conteúdo, como “Fotona Laser” ou “Institucional”. Elas organizam o pipeline e aparecem no menu Projetos.", href: "?aba=servicos", cta: "Cadastrar subdivisão", allowed: can.clients },
    { done: hasTarget, title: "Defina a meta do mês", text: "Quantos conteúdos aprovados vocês combinaram entregar por mês. Serve para acompanhar se o contrato está em dia.", href: "?aba=servicos", cta: "Definir meta", allowed: can.clients },
    { done: contentCount > 0, title: "Crie o primeiro conteúdo", text: "Escolha o formato (Reels, carrossel…) e o sistema cria as tarefas de roteiro, gravação, edição, capa e legenda.", href: `/app/conteudos/novo?cliente=${client}`, cta: "Novo conteúdo", allowed: can.contents },
    { done: (movedOn ?? 0) > 0, title: "Acompanhe a produção no pipeline", text: "Cada conteúdo avança sozinho de coluna quando a equipe conclui as tarefas e envia os arquivos.", href: `/app/pipeline?cliente=${client}`, cta: "Abrir pipeline", allowed: true },
    { done: (batchCount ?? 0) > 0, title: "Envie para aprovação do cliente", text: "Gere um link seguro e mande pelo WhatsApp. O cliente aprova ou pede ajustes sem precisar de cadastro.", href: `/app/aprovacoes/novo?cliente=${client}`, cta: "Gerar link de aprovação", allowed: can.approvals },
    { done: (publishedEver ?? 0) > 0, title: "Agende e confirme a publicação", text: "Conteúdos aprovados vão para a coluna Pronto. Registre a data agendada e confirme quando for ao ar.", href: `/app/pipeline?cliente=${client}`, cta: "Ir para o pipeline", allowed: true },
  ];
  const doneSteps = steps.filter((x) => x.done).length;
  const nextStep = steps.findIndex((x) => !x.done);

  // "Equipe agora": open work per person on this client, plus what they finished in the selected month.
  const nowIso = new Date().toISOString();
  const m0 = `${month}T00:00:00`; const m1 = `${ym(next)}-01T00:00:00`;
  const team = new Map<string, { todo: number; doing: number; done: number; late: number }>();
  for (const t of (taskRows ?? []) as Array<{ assignee_id: string | null; status: string; due_at: string | null; completed_at: string | null }>) {
    const k = t.assignee_id ?? "";
    const e = team.get(k) ?? { todo: 0, doing: 0, done: 0, late: 0 };
    if (["pending", "reopened", "blocked"].includes(t.status)) e.todo++;
    else if (["in_progress", "in_review"].includes(t.status)) e.doing++;
    else if (t.status === "done" && t.completed_at && t.completed_at >= m0 && t.completed_at < m1) e.done++;
    if (!["done", "blocked"].includes(t.status) && t.due_at && t.due_at < nowIso) e.late++;
    team.set(k, e);
  }
  const teamRows = [...team.entries()]
    .filter(([, e]) => e.todo + e.doing + e.done > 0)
    .map(([id, e]) => ({ id, name: id ? members.get(id)?.full_name || members.get(id)?.email || "Colaborador" : "Sem responsável", avatar: id ? members.get(id)?.avatar_url ?? null : null, ...e }))
    .sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || b.late - a.late || (b.todo + b.doing) - (a.todo + a.doing));

  const stats = [
    { label: "Planejados", value: total.planned, hint: "Conteúdos previstos para publicar neste mês." },
    { label: "Aprovados", value: total.approved, hint: "Liberados pelo cliente no link de aprovação." },
    { label: "Agendados", value: total.scheduled, hint: "Com data marcada para ir ao ar." },
    { label: "Publicados", value: total.published, hint: "Já foram ao ar neste mês." },
  ];

  return (
    <div className="space-y-6">
      {doneSteps < steps.length && (
        <section aria-labelledby="passos" className="rounded-lg border border-border bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 id="passos" className="text-[15px] font-semibold">Primeiros passos com este cliente</h2>
              <p className="text-[13px] text-muted">Siga na ordem para colocar o cliente para rodar. Esta seção some quando tudo estiver feito.</p>
            </div>
            <span className="tabular text-xs text-muted">{doneSteps} de {steps.length} concluídos</span>
          </header>
          <ol className="divide-y divide-border">
            {steps.map((st, i) => {
              const current = i === nextStep;
              return (
                <li key={st.title} className={cn("flex flex-wrap items-start gap-3 px-4 py-3 sm:flex-nowrap", current && "bg-accent-soft/40")}>
                  <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    st.done ? "bg-accent text-accent-fg" : current ? "border-2 border-accent-ink text-accent-ink" : "border border-border-strong text-muted")}>
                    {st.done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-medium", st.done && "text-muted line-through decoration-border-strong")}>
                      {st.title}<span className="sr-only">{st.done ? " (concluído)" : ""}</span>
                    </p>
                    {!st.done && <p className="mt-0.5 text-[13px] text-muted">{st.text}</p>}
                  </div>
                  {!st.done && st.allowed && (
                    <ButtonLink href={st.href} size="sm" variant={current ? "primary" : "secondary"} className="shrink-0">{st.cta}</ButtonLink>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section aria-labelledby="resumo">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="resumo" className="text-[15px] font-semibold">Resumo de {monthName}</h2>
            <p className="text-[13px] text-muted">Considera os conteúdos com publicação prevista para este mês.</p>
          </div>
          <nav aria-label="Mês" className="flex gap-3">
            <Link className="text-xs text-muted hover:text-fg" href={`?aba=visao&mes=${ym(prev)}`}>← mês anterior</Link>
            <Link className="text-xs text-muted hover:text-fg" href={`?aba=visao&mes=${ym(next)}`}>próximo mês →</Link>
          </nav>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-border bg-surface p-4 sm:col-span-2 lg:col-span-1">
            <p className="text-xs font-medium text-muted">Meta do mês</p>
            {target > 0 ? (
              <>
                <p className="tabular mt-1 text-2xl font-semibold">{total.approved}<span className="text-base font-normal text-muted"> de {target}</span></p>
                <Progress className="mt-2" value={total.approved} max={target} label="Aprovados sobre a meta" />
                <p className="mt-2 text-xs text-muted">Aprovados pelo cliente, comparados à meta combinada.</p>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm">Sem meta definida</p>
                <p className="mt-1 text-xs text-muted">Defina quantos conteúdos aprovados vocês entregam por mês.</p>
                {can.clients && <Link href="?aba=servicos" className="mt-2 inline-block text-xs font-medium text-accent-ink hover:underline">Definir meta →</Link>}
              </>
            )}
          </div>
          {stats.map((st) => (
            <div key={st.label} className="rounded-lg border border-border bg-surface p-4">
              <p className="text-xs font-medium text-muted">{st.label}</p>
              <p className="tabular mt-1 text-2xl font-semibold">{st.value}</p>
              <p className="mt-2 text-xs text-muted">{st.hint}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="equipe">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="equipe" className="text-[15px] font-semibold">Equipe agora</h2>
            <p className="text-[13px] text-muted">
              O que cada pessoa tem neste cliente. O status muda quando o colaborador usa <strong className="font-medium text-fg">Iniciar</strong> e{" "}
              <strong className="font-medium text-fg">Concluir</strong> em Minhas tarefas.
            </p>
          </div>
          <Link href={`/app/tarefas?cliente=${client}`} className="text-xs font-medium text-accent-ink hover:underline">Ver todas as tarefas →</Link>
        </div>
        {teamRows.length === 0 ? (
          <Panel><EmptyState compact title="Nenhuma tarefa ainda" description="As tarefas aparecem aqui quando você cria conteúdos para este cliente." /></Panel>
        ) : (
          <Panel padded={false}>
            <Table>
              <thead><tr>
                <th>Pessoa</th>
                <th className="text-right"><span title="Pendentes, reabertas ou aguardando etapa anterior">A fazer</span></th>
                <th className="text-right">Em andamento</th>
                <th className="text-right"><span title={`Concluídas em ${monthName}`}>Concluídas no mês</span></th>
                <th className="text-right">Atrasadas</th>
                <th><span className="sr-only">Ações</span></th>
              </tr></thead>
              <tbody>
                {teamRows.map((p) => (
                  <tr key={p.id || "none"}>
                    <td><span className="flex items-center gap-2">{p.id ? <Avatar name={p.name} src={p.avatar} size={24} /> : null}<span className={p.id ? "" : "text-muted"}>{p.name}</span></span></td>
                    <td className="tabular text-right">{p.todo}</td>
                    <td className="tabular text-right">{p.doing > 0 ? <Badge tone="progress">{p.doing}</Badge> : 0}</td>
                    <td className="tabular text-right">{p.done > 0 ? <Badge tone="success">{p.done}</Badge> : 0}</td>
                    <td className="tabular text-right">{p.late > 0 ? <Badge tone="danger">{p.late}</Badge> : <span className="text-muted">0</span>}</td>
                    <td className="text-right">
                      <Link href={`/app/tarefas?cliente=${client}${p.id ? `&responsavel=${p.id}` : "&situacao=sem_responsavel"}`} className="whitespace-nowrap text-xs font-medium text-accent-ink hover:underline">Ver tarefas</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        )}
      </section>

      <section aria-labelledby="servicos">
        <div className="mb-2">
          <h2 id="servicos" className="text-[15px] font-semibold">Produção por subdivisão</h2>
          <p className="text-[13px] text-muted">
            Em que ponto estão os conteúdos de cada subdivisão neste mês. <strong className="font-medium text-fg">Produção</strong> mostra o que a equipe já entregou;{" "}
            <strong className="font-medium text-fg">Entrega</strong> mostra o que o cliente aprovou e o que já foi publicado.
          </p>
        </div>
        {rows.length === 0 ? (
          <Panel><EmptyState compact title="Nenhuma subdivisão cadastrada" description="Cadastre as subdivisões do cliente para acompanhar a produção de cada uma."
            action={can.clients ? <ButtonLink href="?aba=servicos" variant="primary" size="sm">Cadastrar subdivisão</ButtonLink> : undefined} /></Panel>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {rows.map((r) => {
              const planned = n(r.planned);
              const prod = [["Vídeos", n(r.videos_ready)], ["Capas", n(r.covers_ready)], ["Legendas", n(r.captions_ready)]] as const;
              const deliv = [["Aprovados", n(r.approved)], ["Agendados", n(r.scheduled)], ["Publicados", n(r.published)]] as const;
              return (
                <article key={r.service_id ?? "none"} className="rounded-lg border border-border bg-surface">
                  <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <div className="min-w-0">
                      <ServiceDot color={r.service_color} name={subdivisionText(r.service_name)} />
                      <p className="mt-0.5 text-xs text-muted">
                        {planned === 0 ? "Nenhum conteúdo previsto neste mês" : `${planned} conteúdo(s) previsto(s)`}
                        {r.service_target ? ` · meta de ${r.service_target} aprovados` : ""}
                      </p>
                    </div>
                    {r.service_id && (
                      <Link href={`/app/pipeline?cliente=${client}&servico=${r.service_id}`} className="shrink-0 text-xs font-medium text-accent-ink hover:underline">Ver no pipeline →</Link>
                    )}
                  </header>
                  <div className="grid gap-4 p-4 sm:grid-cols-2">
                    {[["Produção", "arquivos e textos já enviados", prod], ["Entrega", "decisão do cliente e publicação", deliv]].map(([title, sub, items]) => (
                      <div key={title as string}>
                        <p className="text-xs font-semibold">{title as string} <span className="font-normal text-muted">· {sub as string}</span></p>
                        <ul className="mt-2 space-y-2">
                          {(items as ReadonlyArray<readonly [string, number]>).map(([label, v]) => (
                            <li key={label}>
                              <div className="flex justify-between text-xs"><span className="text-muted">{label}</span><span className="tabular font-medium">{v}/{planned}</span></div>
                              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                                <div className={cn("h-full rounded-full", planned > 0 && v >= planned ? "bg-accent" : "bg-fg/50")} style={{ width: `${planned ? Math.min(100, (v / planned) * 100) : 0}%` }} />
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Cada conteúdo conta uma vez: um Reels com vídeo, capa e legenda é 1 conteúdo. “Enviado” não significa aprovado — a aprovação é do cliente.</p>
      </section>
    </div>
  );
}

async function ClientContents({ ws, client }: { ws: string; client: string }) {
  const sb = await createClient();
  const { data } = await sb.from("content_items").select(contentSelect).eq("workspace_id", ws).eq("client_id", client)
    .is("archived_at", null).order("updated_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as unknown as ContentRow[];
  const thumb = await thumbnails(rows);
  return (
    <Panel padded={false} actions={<Link href={`/app/conteudos?cliente=${client}`} className="text-xs text-muted hover:text-fg">Abrir na central com filtros</Link>} title="Conteúdos recentes">
      {rows.length === 0 ? <EmptyState icon={<Film />} title="Nenhum conteúdo para este cliente" /> : <ContentTable rows={rows} thumb={thumb} showClient={false} />}
    </Panel>
  );
}

async function TargetsPanel({ ws, client, canManage, services }: { ws: string; client: string; canManage: boolean; services: Array<{ id: string; name: string }> }) {
  const sb = await createClient();
  const [{ data }, formats] = await Promise.all([
    sb.from("monthly_targets").select("id, month, target, service_id, format_id").eq("client_id", client).order("month", { ascending: false }).limit(48),
    listFormats(ws),
  ]);
  return <TargetsManager clientId={client} targets={(data ?? []) as never} services={services} formats={formats.map((f) => ({ id: f.id, name: f.name }))} canManage={canManage} />;
}

async function ClientTasks({ ws, client, me, canManage }: { ws: string; client: string; me: string; canManage: boolean }) {
  const sb = await createClient();
  const [{ data }, members] = await Promise.all([
    sb.from("tasks").select(taskSelect).eq("client_id", client).not("status", "in", "(done,cancelled)").order("due_at", { ascending: true, nullsFirst: false }).limit(200),
    memberMap(ws),
  ]);
  return (
    <Panel padded={false} title="Tarefas em aberto" actions={<Link href={`/app/tarefas?cliente=${client}`} className="text-xs text-muted hover:text-fg">Central de tarefas</Link>}>
      <TaskList tasks={(data ?? []) as unknown as TaskRow[]} members={members} currentUser={me} canManage={canManage} empty="Nenhuma tarefa em aberto" />
    </Panel>
  );
}

async function ClientApprovals({ client }: { client: string }) {
  const sb = await createClient();
  const { data } = await sb.from("approval_batches").select("id, name, status, created_at, submitted_at, approval_batch_items(count)")
    .eq("client_id", client).order("created_at", { ascending: false }).limit(50);
  return (
    <Panel padded={false} title="Lotes de aprovação">
      {(data ?? []).length === 0 ? <EmptyState compact icon={<Stamp />} title="Nenhum lote enviado" /> : (
        <Table>
          <thead><tr><th>Lote</th><th>Conteúdos</th><th>Status</th><th>Enviado</th></tr></thead>
          <tbody>
            {(data ?? []).map((b) => (
              <tr key={b.id as string}>
                <td><Link href={`/app/aprovacoes/${b.id}`} className="font-medium hover:underline">{b.name as string}</Link></td>
                <td className="tabular">{(b.approval_batch_items as unknown as Array<{ count: number }>)[0]?.count ?? 0}</td>
                <td>{b.status === "submitted" ? <Badge tone="success">Avaliação finalizada</Badge> : b.status === "closed" ? <Badge>Encerrado</Badge> : <Badge tone="info">Aberto</Badge>}</td>
                <td className="text-muted">{relative(b.created_at as string)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

async function ClientFiles({ client }: { client: string }) {
  const sb = await createClient();
  const { data } = await sb.from("file_assets").select(assetSelect).eq("client_id", client).is("archived_at", null).order("created_at", { ascending: false }).limit(60);
  const rows = (data ?? []) as AssetRow[];
  const urls = await signPaths(rows.filter((r) => r.mime_type?.startsWith("image/")).map((r) => r.thumbnail_path ?? r.storage_path));
  return (
    <Panel padded={false} title="Arquivos do cliente" actions={<Link href={`/app/arquivos?cliente=${client}`} className="text-xs text-muted hover:text-fg">Abrir biblioteca</Link>}>
      {rows.length === 0 ? <EmptyState compact title="Nenhum arquivo" description="Envie arquivos ou conecte uma pasta do Google Drive." /> : (
        <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 lg:grid-cols-6">
          {rows.map((f) => {
            const u = urls.get(f.thumbnail_path ?? f.storage_path ?? "");
            return (
              <li key={f.id} className="overflow-hidden rounded-md border border-border">
                <div className="flex aspect-square items-center justify-center bg-surface-2 text-xs text-subtle">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
                  {u ? <img src={u} alt="" className="size-full object-cover" loading="lazy" /> : (f.mime_type?.split("/")[0] ?? "arquivo")}
                </div>
                <div className="p-2"><p className="truncate text-xs font-medium" title={f.name}>{f.name}</p><p className="text-[11px] text-muted">{f.provider === "drive" ? "Google Drive" : bytes(f.size_bytes)}</p></div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

async function ClientHistory({ ws, client }: { ws: string; client: string }) {
  const sb = await createClient();
  const [{ data }, members] = await Promise.all([
    sb.from("activity_logs").select("id, action, actor_type, actor_label, actor_id, data, created_at, content_id").eq("client_id", client).order("created_at", { ascending: false }).limit(100),
    memberMap(ws),
  ]);
  return (
    <Panel padded={false} title="Histórico">
      {(data ?? []).length === 0 ? <EmptyState compact title="Sem atividades registradas" /> : (
        <ol className="divide-y divide-border">
          {(data ?? []).map((ev) => (
            <li key={ev.id as number} className="flex items-start gap-3 px-4 py-2 text-[13px]">
              <time className="w-28 shrink-0 text-xs text-subtle" dateTime={ev.created_at as string}>{formatDateTime(ev.created_at as string)}</time>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{ev.actor_type === "client" ? `${ev.actor_label} (cliente)` : members.get(ev.actor_id as string)?.full_name ?? "Sistema"}</span>{" "}
                <span className="text-muted">{activityText(ev.action as string, ev.data as Record<string, unknown>)}</span>
                {ev.content_id && <Link href={`/app/conteudos/${ev.content_id}`} className="ml-2 text-xs text-muted underline-offset-2 hover:underline">ver conteúdo</Link>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

async function ClientTeamPanel({ ws, client, canManage }: { ws: string; client: string; canManage: boolean }) {
  const sb = await createClient();
  const [{ data }, members] = await Promise.all([
    sb.from("client_members").select("user_id").eq("client_id", client),
    listMembers(ws),
  ]);
  return (
    <Panel title="Colaboradores responsáveis">
      <ClientTeam clientId={client} canManage={canManage}
        members={members.filter((m) => m.status === "active" && m.user_id).map((m) => ({ id: m.user_id, name: m.full_name, roles: m.roles }))}
        selected={(data ?? []).map((r) => r.user_id as string)} />
      <p className="mt-3 text-xs text-muted">Quem não tem a permissão “ver todos os clientes” só enxerga os clientes em que está alocado.</p>
    </Panel>
  );
}

