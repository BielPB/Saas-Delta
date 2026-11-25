import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Stamp } from "lucide-react";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { contentSelect, listFormats, listMembers, memberMap, postBlockers, postThumbs, signPaths, taskSelect, assetSelect, type AssetRow, type ContentRow, type TaskRow } from "@/lib/data";
import { formatDateTime, monthStart, relative, bytes, toLocalInput } from "@/lib/format";
import { formatGroups, postStatus, type WorkStatus } from "@/lib/post-status";
import { loadPostDetail } from "@/lib/post-detail";
import { cn, isUuid } from "@/lib/utils";
import { subdivisionText } from "@/lib/labels";
import { activityText } from "@/lib/activity";
import { ButtonLink } from "@/components/ui/button";
import { Avatar, Badge, EmptyState, Panel, Progress, Table } from "@/components/ui/primitives";
import { ServiceDot } from "@/components/content/badges";
import { TaskList } from "@/components/tasks/task-list";
import { ClientForm } from "../client-form";
import { ClientStatusActions, ClientTeam, ServicesManager, TargetsManager } from "./client-panels";
import { PostGrid, type GridPost } from "./post-grid";
import { PostDrawer } from "./post-drawer";
import { FeedApproval, type FeedTile } from "./feed-approval";
import { DuplicateMonth, OnboardingBar, ProfileForm } from "./client-sheet";
import { ClientLogo } from "./client-logo";
import { DownloadMonth } from "./download-month";
import { onboardingOf } from "@/lib/client-sheet";

export const metadata: Metadata = { title: "Cliente" };

const TABS = ["posts", "reels", "stories", "aprovacoes", "ficha", "visao", "servicos", "tarefas", "arquivos", "historico", "configuracoes"] as const;
type Tab = (typeof TABS)[number];

interface Progress {
  service_id: string | null; service_name: string; service_color: string; service_target: number | null; client_target: number;
  planned: number; videos_ready: number; covers_ready: number; captions_ready: number; approved: number; scheduled: number; published: number;
}

const monthLabel = (ym: string) => {
  const s = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(`${ym}-15T12:00:00`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const shiftMonth = (ym: string, d: number) => { const x = new Date(`${ym}-15T12:00:00`); x.setMonth(x.getMonth() + d); return x.toISOString().slice(0, 7); };

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string; mes?: string; novo?: string; post?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const ctx = await getContext();
  const sb = await createClient();
  const { data: client } = await sb.from("clients").select("*").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!client) notFound(); // RLS: not allocated => invisible => 404 (no existence leak)

  const tab: Tab = (TABS as readonly string[]).includes(sp.aba ?? "") ? (sp.aba as Tab) : "posts";
  const ym = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : monthStart().slice(0, 7);
  const month = `${ym}-01`;
  const canManage = ctx.can("clients.manage");
  const isGrid = tab === "posts" || tab === "reels" || tab === "stories";

  const [{ data: services }, formats] = await Promise.all([
    sb.from("client_services").select("*").eq("client_id", id).order("name"),
    listFormats(ctx.workspace.id),
  ]);
  const tabHref = (t: Tab, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ aba: t, mes: ym, ...extra });
    return `/app/clientes/${id}?${p}`;
  };
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "posts", label: "Posts" }, { key: "reels", label: "Reels" }, { key: "stories", label: "Stories" },
    { key: "aprovacoes", label: "Aprovação" }, { key: "ficha", label: "Ficha do cliente" }, { key: "visao", label: "Visão geral" }, { key: "servicos", label: "Subdivisões" },
    { key: "tarefas", label: "Tarefas" }, { key: "arquivos", label: "Arquivos" }, { key: "historico", label: "Histórico" }, { key: "configuracoes", label: "Configurações" },
  ];

  return (
    <>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <ClientLogo workspaceId={ctx.workspace.id} clientId={id} name={client.name as string} canEdit={canManage}
            src={client.logo_path ? (await signPaths([client.logo_path as string], 3600)).get(client.logo_path as string) ?? null : null} />
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight">
              {client.name as string}
              {client.is_sensitive && <Badge tone="warning">Sensível</Badge>}
              {client.status !== "active" && <Badge>{client.status === "archived" ? "Arquivado" : "Inativo"}</Badge>}
            </h1>
            <p className="truncate text-[13px] text-muted">{[client.segment, client.company_name, client.instagram].filter(Boolean).join(" · ") || "Cliente"}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(isGrid || tab === "visao" || tab === "aprovacoes") && (
            <nav aria-label="Mês" className="flex items-center rounded-full border border-border bg-surface">
              <Link href={tabHref(tab, { mes: shiftMonth(ym, -1) })} aria-label="Mês anterior" className="flex size-8 items-center justify-center rounded-full text-muted hover:text-fg"><ChevronLeft className="size-4" /></Link>
              <span className="min-w-32 text-center text-[13px] font-semibold">{monthLabel(ym)}</span>
              <Link href={tabHref(tab, { mes: shiftMonth(ym, 1) })} aria-label="Próximo mês" className="flex size-8 items-center justify-center rounded-full text-muted hover:text-fg"><ChevronRight className="size-4" /></Link>
            </nav>
          )}
          {(isGrid || tab === "aprovacoes") && <DownloadMonth clientId={id} ym={ym} fileName={`${String(client.name).toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "cliente"}-${ym}.zip`} />}
          {isGrid && ctx.can("contents.manage") && <DuplicateMonth clientId={id} ym={ym} monthLabel={monthLabel(ym)} nextLabel={monthLabel(shiftMonth(ym, 1))} />}
        </div>
      </header>

      {(isGrid || tab === "visao") && <OnboardingBar clientId={id} items={onboardingOf(client.onboarding)} canEdit={canManage} />}

      <nav aria-label="Seções do cliente" className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-border px-1">
        {tabs.map((t, i) => (
          <Link key={t.key} href={tabHref(t.key)} aria-current={tab === t.key ? "page" : undefined}
            className={cn("relative -mb-px flex h-9 shrink-0 items-center border-b-2 border-transparent px-2.5 text-[13px] text-muted hover:text-fg",
              tab === t.key && "border-accent font-semibold text-fg", i === 3 && "ml-3")}>{t.label}</Link>
        ))}
      </nav>

      {isGrid && (
        <PostsTab ws={ctx.workspace.id} clientId={id} tab={tab as "posts" | "reels" | "stories"} ym={ym} postId={isUuid(sp.post) ? sp.post! : null}
          formats={formats} services={((services ?? []) as Array<{ id: string; name: string; active: boolean }>).filter((s) => s.active)}
          me={ctx.user.id} can={{ create: ctx.can("contents.manage"), manage: ctx.can("contents.manage"), submit: ctx.can("approvals.manage") || ctx.can("tasks.manage"), tasks: ctx.can("tasks.manage") }}
          baseHref={tabHref(tab)} />
      )}
      {tab === "visao" && (
        <Overview ws={ctx.workspace.id} client={id} month={month} servicesCount={(services ?? []).length}
          can={{ clients: canManage, contents: ctx.can("contents.manage"), approvals: ctx.can("approvals.manage") }} />
      )}
      {tab === "ficha" && <ProfileForm clientId={id} canEdit={canManage} initial={(client.profile ?? {}) as Record<string, string>} />}
      {tab === "servicos" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <ServicesManager clientId={id} services={(services ?? []) as never} canManage={canManage} created={sp.novo === "1"} />
          <TargetsPanel ws={ctx.workspace.id} client={id} canManage={canManage} services={(services ?? []) as Array<{ id: string; name: string }>} />
        </div>
      )}
      {tab === "tarefas" && <ClientTasks ws={ctx.workspace.id} client={id} me={ctx.user.id} canManage={ctx.can("tasks.manage")} />}
      {tab === "aprovacoes" && (
        <div className="space-y-6">
          <FeedTab ws={ctx.workspace.id} clientId={id} clientName={client.name as string} ym={ym} formats={formats} canSend={ctx.can("approvals.manage")} />
          <details className="group rounded-lg border border-border bg-surface">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">
              Links enviados <ChevronRight className="size-4 text-muted transition-transform group-open:rotate-90" aria-hidden />
            </summary>
            <div className="border-t border-border"><ClientApprovals client={id} /></div>
          </details>
        </div>
      )}
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

/** "Aprovação": the month's feed (posts + reels, newest first) and the button that sends it to the client. */
async function FeedTab({ ws, clientId, clientName, ym, formats, canSend }: {
  ws: string; clientId: string; clientName: string; ym: string; canSend: boolean;
  formats: Array<{ id: string; key: string; name: string; active: boolean }>;
}) {
  const sb = await createClient();
  const feedGroups = formatGroups.filter((g) => g.key !== "stories");
  const fmt = formats.filter((f) => feedGroups.some((g) => g.formats.includes(f.key)));
  const m0 = `${ym}-01T00:00:00Z`; const m1 = `${shiftMonth(ym, 1)}-01T00:00:00Z`;
  const { data } = fmt.length ? await sb.from("content_items").select("id, title, format_id, stage, approval_status, publication_status, work_status, planned_publish_at, created_at")
    .eq("workspace_id", ws).eq("client_id", clientId).is("archived_at", null).neq("publication_status", "cancelled").in("format_id", fmt.map((f) => f.id))
    .or(`and(planned_publish_at.gte.${m0},planned_publish_at.lt.${m1}),and(planned_publish_at.is.null,created_at.gte.${m0},created_at.lt.${m1})`)
    .order("planned_publish_at", { ascending: false, nullsFirst: true }).limit(200) : { data: [] };
  const rows = (data ?? []) as Array<{ id: string; title: string; format_id: string; stage: ContentRow["stage"]; approval_status: ContentRow["approval_status"]; publication_status: ContentRow["publication_status"]; work_status: string; planned_publish_at: string | null; created_at: string }>;
  const ids = rows.map((r) => r.id);
  const [thumbs, blockers] = await Promise.all([postThumbs(ids), postBlockers(ids)]);
  const blockedReason = (id: string) => {
    const b = blockers.get(id);
    if (!b) return null;
    if (b.adjust.length) return `Falta ajuste: ${b.adjust.join(", ")}`;
    if (b.missing.length) return `Falta: ${b.missing.join(", ")}`;
    return null;
  };
  const keyOf = new Map(formats.map((f) => [f.id, f.key]));
  const tiles: FeedTile[] = rows.map((r) => {
    const k = keyOf.get(r.format_id) ?? "";
    const g = formatGroups.find((x) => x.formats.includes(k))?.key ?? "posts";
    const t = thumbs.get(r.id);
    return { id: r.id, title: r.title, thumb: t?.url ?? null, link: t?.link ?? false, video: g === "reels", status: postStatus(r), ready: !blockedReason(r.id), missing: Boolean(blockedReason(r.id)), blocked: blockedReason(r.id),
      href: `/app/clientes/${clientId}?aba=${g}&mes=${ym}&post=${r.id}` };
  });
  const { data: batches } = await sb.from("approval_batches").select("id, status, approval_links(expires_at, revoked_at, last_accessed_at), approval_batch_items(content_id)")
    .eq("workspace_id", ws).eq("client_id", clientId).eq("period_month", `${ym}-01`).in("status", ["open", "submitted"]).order("created_at", { ascending: false }).limit(3);
  type B = { approval_links: Array<{ expires_at: string | null; revoked_at: string | null; last_accessed_at: string | null }>; approval_batch_items: Array<{ content_id: string }> };
  const live = ((batches ?? []) as unknown as B[]).map((b) => ({ b, l: b.approval_links.find((l) => !l.revoked_at && (!l.expires_at || new Date(l.expires_at) > new Date())) })).find((x) => x.l);
  const activeLink = live ? { expires: live.l!.expires_at, lastAccess: live.l!.last_accessed_at, posts: live.b.approval_batch_items.length } : null;
  return <FeedApproval tiles={tiles} clientId={clientId} clientName={clientName} ym={ym} monthLabel={monthLabel(ym)} canSend={canSend} activeLink={activeLink} />;
}

/** Posts / Reels / Stories of the month as a grid; ?post=<id> opens the side panel. */
async function PostsTab({ ws, clientId, tab, ym, postId, formats, services, me, can, baseHref }: {
  ws: string; clientId: string; tab: "posts" | "reels" | "stories"; ym: string; postId: string | null;
  formats: Array<{ id: string; key: string; name: string; aspect_ratio: string | null; active: boolean }>;
  services: Array<{ id: string; name: string }>; me: string; can: { create: boolean; manage: boolean; submit: boolean; tasks: boolean }; baseHref: string;
}) {
  const sb = await createClient();
  const group = formatGroups.find((g) => g.key === tab)!;
  const groupFormats = formats.filter((f) => f.active && group.formats.includes(f.key));
  const m0 = `${ym}-01T00:00:00Z`; const m1 = `${shiftMonth(ym, 1)}-01T00:00:00Z`;
  const [{ data }, members] = await Promise.all([
    groupFormats.length
      ? sb.from("content_items").select(`${contentSelect}, work_status, editor_id`).eq("workspace_id", ws).eq("client_id", clientId).is("archived_at", null)
        .neq("publication_status", "cancelled").in("format_id", groupFormats.map((f) => f.id))
        .or(`and(planned_publish_at.gte.${m0},planned_publish_at.lt.${m1}),and(planned_publish_at.is.null,created_at.gte.${m0},created_at.lt.${m1})`)
        .order("planned_publish_at", { ascending: true, nullsFirst: false }).order("code").limit(300)
      : Promise.resolve({ data: [] as unknown[] }),
    memberMap(ws),
  ]);
  const rows = (data ?? []) as unknown as Array<ContentRow & { work_status: string; editor_id: string | null }>;
  const ids = rows.map((r) => r.id);
  const [thumbs, { data: ass }, { data: com }] = await Promise.all([
    postThumbs(ids),
    ids.length ? sb.from("content_assignees").select("content_id, user_id").in("content_id", ids) : Promise.resolve({ data: [] as unknown[] }),
    ids.length ? sb.from("comments").select("content_id").in("content_id", ids) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const assignBy = new Map<string, string[]>();
  for (const a of (ass ?? []) as Array<{ content_id: string; user_id: string }>) assignBy.set(a.content_id, [...(assignBy.get(a.content_id) ?? []), a.user_id]);
  const commentsBy = new Map<string, number>();
  for (const c of (com ?? []) as Array<{ content_id: string }>) commentsBy.set(c.content_id, (commentsBy.get(c.content_id) ?? 0) + 1);
  const fmtByKey = new Map(formats.map((f) => [f.id, f]));
  const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Fortaleza" });

  const posts: GridPost[] = rows.map((r, i) => {
    const people = [...new Set([...(assignBy.get(r.id) ?? []), ...(r.editor_id ? [r.editor_id] : [])])]
      .map((u) => members.get(u)).filter(Boolean).map((m) => ({ name: m!.full_name, avatar: m!.avatar_url }));
    const t = thumbs.get(r.id);
    return {
      id: r.id, number: i + 1, title: r.title, format: r.content_formats?.name ?? "Post", formatKey: fmtByKey.get(r.format_id)?.key ?? "",
      status: postStatus(r), thumb: t?.url ?? null, link: t?.link ?? false, people, comments: commentsBy.get(r.id) ?? 0,
      date: r.planned_publish_at ? dateFmt.format(new Date(r.planned_publish_at)) : null,
    };
  });
  const hrefFor = Object.fromEntries(posts.map((p) => [p.id, `${baseHref}&post=${p.id}`]));
  const activeMembers = [...members.values()].filter((m) => m.status === "active" && m.user_id).map((m) => ({ id: m.user_id, name: m.full_name, avatar: m.avatar_url }));

  let drawer: React.ReactNode = null;
  if (postId) {
    const d = await loadPostDetail(ws, postId, members, me, { manage: can.manage, submit: can.submit });
    if (d) {
      const idx = posts.findIndex((p) => p.id === postId);
      const c = d.content;
      drawer = (
        <PostDrawer workspaceId={ws} closeHref={baseHref} prevHref={idx > 0 ? hrefFor[posts[idx - 1].id] : null} nextHref={idx >= 0 && idx < posts.length - 1 ? hrefFor[posts[idx + 1].id] : null}
          post={{
            id: c.id, code: c.code, number: idx >= 0 ? idx + 1 : 0, title: c.title, clientId, lock: c.lock_version, status: postStatus(c),
            work: (["planning", "production", "review"].includes(c.work_status) ? c.work_status : "planning") as WorkStatus,
            format: c.content_formats?.name ?? "", aspect: c.content_formats?.aspect_ratio ?? "4:5", planned: toLocalInput(c.planned_publish_at),
            serviceId: c.service_id, briefing: c.briefing ?? "", editorId: c.editor_id, assignees: d.assigneeIds,
          }}
          viewer={d.viewer} managerItems={d.managerItems} missing={d.missing} adjust={d.adjust} tasks={d.tasks} canTask={can.tasks} comments={d.comments} members={activeMembers} services={services}
          canEdit={d.canEdit} canSubmit={d.canSubmit} />
      );
    }
  }

  const defaultDate = `${ym}-${ym === new Date().toISOString().slice(0, 7) ? String(new Date().getDate()).padStart(2, "0") : "01"}T09:00`;
  return (
    <>
      <PostGrid posts={posts} hrefFor={hrefFor} baseHref={baseHref} label={group.label} clientId={clientId}
        formats={groupFormats.map((f) => ({ id: f.id, name: f.name, key: f.key }))} services={services} canCreate={can.create} defaultDate={defaultDate} />
      {drawer}
    </>
  );
}

async function Overview({ ws, client, month, servicesCount, can }: {
  ws: string; client: string; month: string; servicesCount: number;
  can: { clients: boolean; contents: boolean; approvals: boolean };
}) {
  const sb = await createClient();
  const [{ data }, { count: batchCount }, { count: publishedEver }, { count: movedOn }, { data: taskRows }, members, { count: contentCount }] = await Promise.all([
    sb.rpc("client_progress", { p_ws: ws, p_month: month, p_client: client }),
    sb.from("approval_batches").select("id", { count: "exact", head: true }).eq("client_id", client),
    sb.from("content_items").select("id", { count: "exact", head: true }).eq("client_id", client).eq("publication_status", "published"),
    sb.from("content_items").select("id", { count: "exact", head: true }).eq("client_id", client).not("stage", "in", "(planning,cancelled)"),
    sb.from("tasks").select("assignee_id, status, due_at, completed_at").eq("client_id", client).neq("status", "cancelled").limit(3000),
    memberMap(ws),
    sb.from("content_items").select("id", { count: "exact", head: true }).eq("client_id", client).is("archived_at", null),
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
    { done: (contentCount ?? 0) > 0, title: "Crie o primeiro post", text: "Na aba Posts (ou Reels/Stories), clique em Novo post. Depois envie a mídia e a legenda no próprio post.", href: `/app/clientes/${client}?aba=posts`, cta: "Ir para Posts", allowed: can.contents },
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

