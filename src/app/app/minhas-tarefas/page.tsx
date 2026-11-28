import type { Metadata } from "next";
import { ChevronDown } from "lucide-react";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { contentSelect, listClientsLite, listFormats, memberMap, openPostsLite, taskSelect, type ContentRow, type TaskRow } from "@/lib/data";
import { formatGroups, postStatus } from "@/lib/post-status";
import { isUuid } from "@/lib/utils";
import { TaskList } from "@/components/tasks/task-list";
import { ViewAs } from "./view-as";
import { AgendaStrip } from "./agenda";
import { Demands, type DemandRow } from "./demands";
import { Suspense } from "react";
import { appOrigin } from "@/lib/origin";
import { NewTaskButton } from "@/app/app/tarefas/new-task";

export const metadata: Metadata = { title: "Minhas demandas" };

type Row = ContentRow & { work_status: string; editor_id: string | null };
const DAY = 864e5;

export default async function MyWorkPage({ searchParams }: { searchParams: Promise<{ f?: string; cliente?: string; ordem?: string; pessoa?: string }> }) {
  const ctx = await getContext();
  const sp = await searchParams;
  const sb = await createClient();
  const canViewOthers = ctx.can("tasks.view_all");
  const canManageTasks = ctx.can("tasks.manage");
  const uid = canViewOthers && isUuid(sp.pessoa) ? sp.pessoa! : ctx.user.id;
  const ws = ctx.workspace.id;

  // Independent queries run together (each round trip to Supabase costs ~140 ms).
  const [{ data: mine }, members, formats, { data: taskData }, newTask, origin] = await Promise.all([
    sb.from("content_assignees").select("content_id").eq("workspace_id", ws).eq("user_id", uid),
    memberMap(ws),
    listFormats(ws),
    sb.from("tasks").select(taskSelect).eq("workspace_id", ws).eq("assignee_id", uid).not("status", "in", "(done,cancelled)")
      .order("due_at", { ascending: true, nullsFirst: false }).limit(200),
    canManageTasks ? Promise.all([listClientsLite(ws), openPostsLite(ws)]) : Promise.resolve(null),
    appOrigin(),
  ]);
  const ids = (mine ?? []).map((m) => m.content_id as string);
  let q = sb.from("content_items").select(`${contentSelect}, work_status, editor_id`).eq("workspace_id", ws).is("archived_at", null)
    .not("stage", "in", "(published,cancelled)").limit(500);
  q = ids.length ? q.or(`editor_id.eq.${uid},id.in.(${ids.join(",")})`) : q.eq("editor_id", uid);
  const { data } = await q;
  const all = (data ?? []) as unknown as Row[];
  // Tasks given to the person (general ones always; template steps only when the post is not already listed above).
  const tasks = ((taskData ?? []) as unknown as TaskRow[]).filter((t) => t.kind === "general" || !t.content_id || !all.some((p) => p.id === t.content_id));

  const now = new Date().getTime();
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const due = (r: Row) => r.due_at ?? r.planned_publish_at;
  const isOpenWork = (r: Row) => !["ready", "scheduled"].includes(postStatus(r));
  const isLate = (r: Row) => { const d = due(r); return Boolean(d && new Date(d).getTime() < now && isOpenWork(r)); };
  const isToday = (r: Row) => { const d = due(r); if (!d) return false; const t = new Date(d).getTime(); return t >= startToday.getTime() && t < startToday.getTime() + DAY && !isLate(r); };
  const inWeek = (r: Row) => { const d = due(r); if (!d) return false; const t = new Date(d).getTime(); return t >= now && t < now + 7 * DAY; };

  const fmtKey = new Map(formats.map((x) => [x.id, x.key]));
  const hrefOf = (r: Row) => {
    const g = formatGroups.find((x) => x.formats.includes(fmtKey.get(r.format_id) ?? ""))?.key ?? "posts";
    return `/app/clientes/${r.client_id}?aba=${g}&mes=${(r.planned_publish_at ?? r.created_at).slice(0, 7)}&post=${r.id}`;
  };
  const dueLabel = (r: Row) => {
    const d = due(r);
    if (!d) return null;
    const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - startToday.getTime()) / DAY);
    if (isLate(r)) return { text: days === 0 ? "Atrasado hoje" : `Atrasado ${-days} dia${days === -1 ? "" : "s"}`, late: true };
    return { text: days === 0 ? "Hoje" : days === 1 ? "Amanhã" : `Em ${days} dias`, late: false };
  };
  // Dates are judged here (one clock, one timezone); the browser only filters and groups.
  const rows: DemandRow[] = all.map((r) => ({
    id: r.id, title: r.title, href: hrefOf(r), clientId: r.client_id, clientName: r.clients?.name ?? "", format: r.content_formats?.name ?? "",
    status: postStatus(r), due: due(r), late: isLate(r), today: isToday(r), week: inWeek(r), dueLabel: dueLabel(r),
  }));
  const activeMembers = [...members.values()].filter((m) => m.status === "active" && m.user_id).map((m) => ({ id: m.user_id, name: m.full_name }));

  const person = members.get(uid);
  const displayName = ctx.profile.full_name;
  const hour = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: ctx.workspace.timezone }).format(new Date()));
  const hello = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  return (
    <div className="max-w-5xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Minhas demandas</p>
          <h1 className="mt-0.5 break-words text-xl font-bold tracking-tight sm:text-2xl">{uid === ctx.user.id ? `${hello}${displayName ? `, ${displayName}` : ""}!` : `Demandas de ${person?.full_name ?? "colaborador"}`}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canViewOthers && <ViewAs value={uid} me={ctx.user.id} members={activeMembers} />}
          {newTask && <NewTaskButton clients={newTask[0]} posts={newTask[1]} members={activeMembers} />}
        </div>
      </header>

      <div className="demand-overview-width">
        <Suspense fallback={<div className="skeleton mb-5 h-36 rounded-xl" aria-hidden />}>
          <AgendaStrip ws={ws} uid={uid} isSelf={uid === ctx.user.id} tz={ctx.workspace.timezone} origin={origin} />
        </Suspense>
      </div>

      {/* key: switching "Ver como" to another person starts from that person's URL filters. */}
      <Demands key={uid} rows={rows} hasTasks={tasks.length > 0} initial={{ f: sp.f ?? null, cliente: sp.cliente ?? null, ordem: sp.ordem ?? null }} />

      {tasks.length > 0 && (
        <details className="group mt-6 rounded-lg border border-border bg-surface" open={tasks.some((t) => t.kind === "general")}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="text-[13px] font-semibold">Tarefas <span className="tabular ml-1 font-normal text-muted">{tasks.length}</span>
              <span className="ml-2 text-xs font-normal text-subtle">atribuídas a você (edição, gravação, reunião…)</span></span>
            <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="border-t border-border">
            <TaskList tasks={tasks} members={members} showAssignee={false} currentUser={ctx.user.id} canManage={canManageTasks} />
          </div>
        </details>
      )}
    </div>
  );
}
