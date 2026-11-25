import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Film, Plus, Stamp } from "lucide-react";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { contentSelect, listFormats, listMembers, memberMap, signPaths, taskSelect, thumbnails, assetSelect, type AssetRow, type ContentRow, type TaskRow } from "@/lib/data";
import { formatDateTime, monthStart, relative, bytes } from "@/lib/format";
import { isUuid } from "@/lib/utils";
import { activityText } from "@/lib/activity";
import { ButtonLink } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Panel, Progress, Table } from "@/components/ui/primitives";
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
    { key: "servicos", label: "Serviços", count: (services ?? []).length }, { key: "calendario", label: "Calendário" },
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

      {tab === "visao" && <Overview ws={ctx.workspace.id} client={id} month={month} />}
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

async function Overview({ ws, client, month }: { ws: string; client: string; month: string }) {
  const sb = await createClient();
  const { data } = await sb.rpc("client_progress", { p_ws: ws, p_month: month, p_client: client });
  const rows = (data ?? []) as Progress[];
  const total = rows.reduce((a, r) => ({
    planned: a.planned + Number(r.planned), approved: a.approved + Number(r.approved), published: a.published + Number(r.published),
    scheduled: a.scheduled + Number(r.scheduled),
  }), { planned: 0, approved: 0, published: 0, scheduled: 0 });
  const target = rows[0]?.client_target ?? 0;
  const prev = new Date(`${month}T12:00:00`); prev.setMonth(prev.getMonth() - 1);
  const next = new Date(`${month}T12:00:00`); next.setMonth(next.getMonth() + 1);
  const ym = (d: Date) => d.toISOString().slice(0, 7);
  const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(`${month}T12:00:00`));
  const maxPlanned = Math.max(1, ...rows.map((r) => Number(r.planned)));

  return (
    <div className="space-y-4">
      <Panel title={monthName.charAt(0).toUpperCase() + monthName.slice(1)} actions={<>
        <Link className="text-xs text-muted hover:text-fg" href={`?aba=visao&mes=${ym(prev)}`}>← anterior</Link>
        <Link className="text-xs text-muted hover:text-fg" href={`?aba=visao&mes=${ym(next)}`}>próximo →</Link>
      </>}>
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <p className="text-xs text-muted">Meta mensal (aprovados)</p>
            <Progress className="mt-2" value={total.approved} max={target} label="Aprovados sobre a meta" />
          </div>
          <div><p className="text-xs text-muted">Planejados</p><p className="tabular text-xl font-semibold">{total.planned}</p></div>
          <div><p className="text-xs text-muted">Publicados</p><p className="tabular text-xl font-semibold">{total.published}</p></div>
        </div>
      </Panel>
      <Panel title="Operação por serviço" padded={false}>
        {rows.length === 0 ? <EmptyState compact title="Nenhum serviço ativo" description="Cadastre serviços para acompanhar metas por pilar." /> : (
          <Table>
            <thead><tr><th>Serviço</th><th>Volume</th><th className="text-right">Planejados</th><th className="text-right">Vídeos prontos</th><th className="text-right">Capas prontas</th><th className="text-right">Legendas prontas</th><th className="text-right">Aprovados</th><th className="text-right">Agendados</th><th className="text-right">Publicados</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.service_id ?? "none"}>
                  <td><ServiceDot color={r.service_color} name={r.service_name} /></td>
                  <td className="min-w-40">
                    {r.service_target ? <Progress value={Number(r.approved)} max={r.service_target} label={`Meta ${r.service_name}`} /> : (
                      <div className="h-1.5 rounded-full bg-surface-3"><div className="h-full rounded-full bg-fg/50" style={{ width: `${(Number(r.planned) / maxPlanned) * 100}%` }} /></div>
                    )}
                  </td>
                  {[r.planned, r.videos_ready, r.covers_ready, r.captions_ready, r.approved, r.scheduled, r.published].map((v, i) => (
                    <td key={i} className="tabular text-right">{Number(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="border-t border-border px-4 py-2 text-xs text-muted">Valores contam conteúdos (um Reels com vídeo, capa e legenda conta como 1). “Prontos” = entregável com versão enviada.</p>
      </Panel>
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

