import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listClientsLite, listMembers, memberMap, openPostsLite, parseFilters, qs, taskSelect, type TaskRow } from "@/lib/data";
import { taskStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/primitives";
import { TaskList } from "@/components/tasks/task-list";
import { NewTaskButton } from "./new-task";
import { TaskFilters } from "./filters";

export const metadata: Metadata = { title: "Central de tarefas" };

const filters = z.object({
  cliente: z.string().uuid().optional().catch(undefined),
  responsavel: z.string().uuid().optional().catch(undefined),
  status: z.enum(["blocked", "pending", "in_progress", "in_review", "done", "reopened", "cancelled"]).optional().catch(undefined),
  situacao: z.enum(["atrasadas", "abertas", "sem_responsavel", "ajustes"]).optional().catch(undefined),
  pagina: z.coerce.number().int().min(1).optional().catch(undefined),
});

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await getContext();
  const raw = await searchParams;
  const f = parseFilters(filters, raw);
  const sb = await createClient();
  const page = f.pagina ?? 1;
  const size = 100;
  let q = sb.from("tasks").select(taskSelect, { count: "exact" }).eq("workspace_id", ctx.workspace.id);
  if (f.cliente) q = q.eq("client_id", f.cliente);
  if (f.responsavel) q = q.eq("assignee_id", f.responsavel);
  if (f.status) q = q.eq("status", f.status);
  const situacao = f.situacao ?? (f.status ? undefined : "abertas");
  if (situacao === "abertas") q = q.not("status", "in", "(done,cancelled)");
  if (situacao === "atrasadas") q = q.not("status", "in", "(done,cancelled,blocked)").lt("due_at", new Date().toISOString());
  if (situacao === "sem_responsavel") q = q.is("assignee_id", null).not("status", "in", "(done,cancelled)");
  if (situacao === "ajustes") q = q.eq("kind", "adjustment").not("status", "in", "(done,cancelled)");
  q = f.status === "done" ? q.order("completed_at", { ascending: false }) : q.order("due_at", { ascending: true, nullsFirst: false });
  const [{ data, count }, clients, members, mm] = await Promise.all([
    q.range((page - 1) * size, page * size - 1), listClientsLite(ctx.workspace.id), listMembers(ctx.workspace.id), memberMap(ctx.workspace.id),
  ]);
  const tasks = (data ?? []) as unknown as TaskRow[];
  const base = { cliente: f.cliente, responsavel: f.responsavel };
  const tabs: Array<{ label: string; patch: Record<string, string | undefined>; on: boolean }> = [
    { label: "Abertas", patch: { situacao: undefined, status: undefined }, on: situacao === "abertas" },
    { label: "Atrasadas", patch: { situacao: "atrasadas", status: undefined }, on: situacao === "atrasadas" },
    { label: "Ajustes", patch: { situacao: "ajustes", status: undefined }, on: situacao === "ajustes" },
    { label: "Em revisão", patch: { status: "in_review", situacao: undefined }, on: f.status === "in_review" },
    { label: "Concluídas", patch: { status: "done", situacao: undefined }, on: f.status === "done" },
  ];
  const active = members.filter((m) => m.status === "active" && m.user_id);
  const total = count ?? 0;

  return (
    <>
      <PageHeader title="Tarefas da equipe" description="Tarefas avulsas (reunião, gravação, captação…) e etapas de produção. Use “Nova tarefa” para atribuir algo a alguém."
        actions={ctx.can("tasks.manage") && <NewTaskButton clients={clients} posts={await openPostsLite(ctx.workspace.id)} members={active.map((m) => ({ id: m.user_id, name: m.full_name }))} />} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Situação" className="flex rounded-lg border border-border bg-surface p-0.5">
          {tabs.map((t) => (
            <Link key={t.label} href={`/app/tarefas${qs(base, t.patch)}`} aria-current={t.on ? "page" : undefined}
              className={cn("rounded-md px-3 py-1.5 text-[13px] text-muted transition-colors hover:text-fg", t.on && "bg-surface-3 font-medium text-fg")}>{t.label}</Link>
          ))}
        </nav>
        <TaskFilters clients={clients.map((c) => ({ id: c.id, name: c.name }))} members={active.map((m) => ({ id: m.user_id, name: m.full_name }))} />
      </div>
      {situacao === "sem_responsavel" && <p className="mb-2 text-xs text-muted">Mostrando tarefas abertas sem responsável.</p>}
      <section className="rounded-lg border border-border bg-surface">
        <TaskList tasks={tasks} members={mm} currentUser={ctx.user.id} canManage={ctx.can("tasks.manage")} showAssigneeName
          empty={f.status ? `Nenhuma tarefa ${taskStatus[f.status].label.toLowerCase()}.` : "Nenhuma tarefa neste filtro."} />
      </section>
      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span className="tabular">{total} tarefa(s)</span>
        {total > page * size && <Link className="font-medium text-fg underline underline-offset-2" href={`/app/tarefas${qs({ ...raw }, { pagina: page + 1 })}`}>Próxima página</Link>}
      </div>
    </>
  );
}
