import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { contentSelect, listClientsLite, listFormats, memberMap, openPostsLite, taskSelect, type ContentRow, type TaskRow } from "@/lib/data";
import { formatGroups, postStatus, postStatusMeta, type PostStatusKey } from "@/lib/post-status";
import { cn, isUuid } from "@/lib/utils";
import { EmptyState } from "@/components/ui/primitives";
import { TaskList } from "@/components/tasks/task-list";
import { clientHue } from "@/lib/client-color";
import { StatusPill } from "@/app/app/clientes/[id]/post-grid";
import { ViewAs } from "./view-as";
import { NewTaskButton } from "@/app/app/tarefas/new-task";

export const metadata: Metadata = { title: "Minhas demandas" };

type Row = ContentRow & { work_status: string; editor_id: string | null };
const ORDER: PostStatusKey[] = ["adjust", "production", "planning", "review", "client", "ready", "scheduled"];
const DAY = 864e5;

export default async function MyWorkPage({ searchParams }: { searchParams: Promise<{ f?: string; cliente?: string; ordem?: string; pessoa?: string }> }) {
  const ctx = await getContext();
  const sp = await searchParams;
  const sb = await createClient();
  const canViewOthers = ctx.can("tasks.view_all");
  const uid = canViewOthers && isUuid(sp.pessoa) ? sp.pessoa! : ctx.user.id;
  const ws = ctx.workspace.id;

  const [{ data: mine }, members, formats, { data: taskData }] = await Promise.all([
    sb.from("content_assignees").select("content_id").eq("workspace_id", ws).eq("user_id", uid),
    memberMap(ws),
    listFormats(ws),
    sb.from("tasks").select(taskSelect).eq("workspace_id", ws).eq("assignee_id", uid).not("status", "in", "(done,cancelled)")
      .order("due_at", { ascending: true, nullsFirst: false }).limit(200),
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

  const counters = [
    { key: "atrasadas", label: "Atrasadas", n: all.filter(isLate).length, danger: true },
    { key: "hoje", label: "Para hoje", n: all.filter(isToday).length },
    { key: "semana", label: "Próximos 7 dias", n: all.filter(inWeek).length },
    { key: "todas", label: "Todas abertas", n: all.length },
  ];
  const f = counters.some((c) => c.key === sp.f) ? sp.f! : "todas";
  const byFilter = all.filter((r) => (f === "atrasadas" ? isLate(r) : f === "hoje" ? isToday(r) : f === "semana" ? inWeek(r) : true));
  const clientCounts = new Map<string, { name: string; n: number }>();
  for (const r of byFilter) clientCounts.set(r.client_id, { name: r.clients?.name ?? "", n: (clientCounts.get(r.client_id)?.n ?? 0) + 1 });
  const rows = sp.cliente && clientCounts.has(sp.cliente) ? byFilter.filter((r) => r.client_id === sp.cliente) : byFilter;
  const byDeadline = sp.ordem === "prazo";

  const fmtKey = new Map(formats.map((x) => [x.id, x.key]));
  const hrefOf = (r: Row) => {
    const g = formatGroups.find((x) => x.formats.includes(fmtKey.get(r.format_id) ?? ""))?.key ?? "posts";
    return `/app/clientes/${r.client_id}?aba=${g}&mes=${(r.planned_publish_at ?? r.created_at).slice(0, 7)}&post=${r.id}`;
  };
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ f: sp.f, cliente: sp.cliente, ordem: sp.ordem, pessoa: sp.pessoa, ...patch }).filter(([, v]) => v) as Array<[string, string]>);
    return `/app/minhas-tarefas${p.size ? `?${p}` : ""}`;
  };
  const dueLabel = (r: Row) => {
    const d = due(r);
    if (!d) return null;
    const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - startToday.getTime()) / DAY);
    if (isLate(r)) return { text: days === 0 ? "Atrasado hoje" : `Atrasado ${-days} dia${days === -1 ? "" : "s"}`, late: true };
    return { text: days === 0 ? "Hoje" : days === 1 ? "Amanhã" : `Em ${days} dias`, late: false };
  };

  const groups: Array<{ key: string; title: string; rows: Row[] }> = byDeadline
    ? [
        { key: "late", title: "Atrasadas", rows: rows.filter(isLate) },
        { key: "week", title: "Esta semana", rows: rows.filter((r) => !isLate(r) && inWeek(r)) },
        { key: "later", title: "Mais adiante", rows: rows.filter((r) => !isLate(r) && !inWeek(r) && due(r)) },
        { key: "none", title: "Sem data", rows: rows.filter((r) => !due(r)) },
      ]
    : ORDER.map((k) => ({ key: k, title: postStatusMeta[k].label, rows: rows.filter((r) => postStatus(r) === k) }));
  const sortByDue = (a: Row, b: Row) => ((due(a) ?? "9") < (due(b) ?? "9") ? -1 : 1);

  const person = members.get(uid);
  const first = (person?.full_name || ctx.profile.full_name || "").split(" ")[0];
  const hour = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: ctx.workspace.timezone }).format(new Date()));
  const hello = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  return (
    <div className="max-w-5xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Minhas demandas</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{uid === ctx.user.id ? `${hello}${first ? `, ${first}` : ""}!` : `Demandas de ${person?.full_name ?? "colaborador"}`}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canViewOthers && (
            <ViewAs value={uid} me={ctx.user.id}
              members={[...members.values()].filter((m) => m.status === "active" && m.user_id).map((m) => ({ id: m.user_id, name: m.full_name }))} />
          )}
          {ctx.can("tasks.manage") && (
            <NewTaskButton clients={await listClientsLite(ws)} posts={await openPostsLite(ws)}
              members={[...members.values()].filter((m) => m.status === "active" && m.user_id).map((m) => ({ id: m.user_id, name: m.full_name }))} />
          )}
        </div>
      </header>

      <nav aria-label="Filtro por prazo" className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counters.map((c) => (
          <Link key={c.key} href={link({ f: c.key === "todas" ? undefined : c.key, cliente: undefined })} aria-current={f === c.key ? "true" : undefined}
            className={cn("rounded-xl border bg-surface px-4 py-3 transition-colors hover:border-border-strong",
              f === c.key ? "border-accent-ink/70 ring-1 ring-accent-ink/30" : "border-border")}>
            <p className={cn("tabular text-2xl font-bold", c.danger && c.n > 0 && "text-[var(--tone-danger-fg)]")}>{c.n}</p>
            <p className="text-xs text-muted">{c.label}</p>
          </Link>
        ))}
      </nav>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Link href={link({ cliente: undefined })} className={cn("rounded-full border px-3 py-1 text-xs font-medium", !sp.cliente ? "border-accent bg-accent text-accent-fg" : "border-border text-muted hover:text-fg")}>
            Todos os clientes <span className="tabular opacity-70">{byFilter.length}</span>
          </Link>
          {[...clientCounts.entries()].sort((a, b) => b[1].n - a[1].n).map(([id, c]) => (
            <Link key={id} href={link({ cliente: id })} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", sp.cliente === id ? "border-accent bg-accent text-accent-fg" : "border-border text-muted hover:text-fg")}>
              <span className="size-2 rounded-full" style={{ background: `hsl(${clientHue(c.name)} 60% 55%)` }} aria-hidden />{c.name} <span className="tabular opacity-70">{c.n}</span>
            </Link>
          ))}
        </div>
        <nav aria-label="Agrupar" className="flex rounded-lg border border-border bg-surface p-0.5 text-xs">
          <Link href={link({ ordem: undefined })} aria-current={!byDeadline ? "page" : undefined} className={cn("rounded-md px-2.5 py-1 text-muted", !byDeadline && "bg-surface-3 font-medium text-fg")}>Por etapa</Link>
          <Link href={link({ ordem: "prazo" })} aria-current={byDeadline ? "page" : undefined} className={cn("rounded-md px-2.5 py-1 text-muted", byDeadline && "bg-surface-3 font-medium text-fg")}>Por prazo</Link>
        </nav>
      </div>

      {rows.length === 0 ? (
        <section className="rounded-xl border border-border bg-surface">
          <EmptyState compact title={all.length ? "Nada neste filtro" : tasks.length ? "Nenhum post com você" : "Nenhuma demanda aberta"}
            description={all.length ? "Troque o filtro acima para ver as outras demandas." : "Quando você for marcado como responsável ou editor de um post, ele aparece aqui."} />
        </section>
      ) : (
        <div className="space-y-5">
          {groups.filter((g) => g.rows.length > 0).map((g) => (
            <section key={g.key} aria-labelledby={`g-${g.key}`}>
              <h2 id={`g-${g.key}`} className="mb-1.5 flex items-baseline gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {g.title} <span className="tabular font-normal">{g.rows.length}</span>
              </h2>
              <ul className="space-y-1.5">
                {[...g.rows].sort(sortByDue).map((r) => {
                  const d = dueLabel(r);
                  const hue = clientHue(r.clients?.name ?? "");
                  return (
                    <li key={r.id}>
                      <Link href={hrefOf(r)} className="flex items-center gap-3 rounded-lg border border-border bg-surface py-2.5 pr-3 transition-colors hover:border-border-strong">
                        <span className="h-9 w-1 shrink-0 rounded-r-full" style={{ background: `hsl(${hue} 60% 55%)` }} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold">{r.title}</span>
                          <span className="flex items-center gap-2 text-xs text-muted">
                            <span style={{ color: `hsl(${hue} 60% 62%)` }}>{r.clients?.name}</span>
                            <span className="rounded border border-border px-1.5 text-[10.5px] uppercase tracking-wide">{r.content_formats?.name}</span>
                            {byDeadline && <StatusPill s={postStatus(r)} />}
                          </span>
                        </span>
                        {d && <span className={cn("shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold", d.late ? "bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]" : "bg-surface-2 text-muted")}>{d.text}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {tasks.length > 0 && (
        <details className="group mt-6 rounded-lg border border-border bg-surface" open={tasks.some((t) => t.kind === "general")}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="text-[13px] font-semibold">Tarefas <span className="tabular ml-1 font-normal text-muted">{tasks.length}</span>
              <span className="ml-2 text-xs font-normal text-subtle">atribuídas a você (edição, gravação, reunião…)</span></span>
            <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="border-t border-border">
            <TaskList tasks={tasks} members={members} showAssignee={false} currentUser={ctx.user.id} canManage={ctx.can("tasks.manage")} />
          </div>
        </details>
      )}
    </div>
  );
}
