import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listClientsLite, listMembers, memberMap, parseFilters, qs, taskSelect, type TaskRow } from "@/lib/data";
import { taskStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { TaskList } from "@/components/tasks/task-list";
import { NewTaskButton } from "./new-task";

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
  const chip = (label: string, patch: Record<string, string | undefined>, on: boolean) => (
    <Link href={`/app/tarefas${qs(base, patch)}`} aria-current={on ? "page" : undefined}
      className={cn("rounded-md px-2.5 py-1 text-[13px] text-muted hover:text-fg", on && "bg-surface-2 font-medium text-fg")}>{label}</Link>
  );
  const active = members.filter((m) => m.status === "active" && m.user_id);

  return (
    <>
      <PageHeader title="Central de tarefas" description={`${count ?? 0} tarefa(s) no filtro atual.`}
        actions={ctx.can("tasks.manage") && <NewTaskButton clients={clients} members={active.map((m) => ({ id: m.user_id, name: m.full_name }))} />} />
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {chip("Abertas", { situacao: undefined }, situacao === "abertas")}
        {chip("Atrasadas", { situacao: "atrasadas" }, situacao === "atrasadas")}
        {chip("Ajustes", { situacao: "ajustes" }, situacao === "ajustes")}
        {chip("Sem responsável", { situacao: "sem_responsavel" }, situacao === "sem_responsavel")}
        {chip("Em revisão", { status: "in_review" }, f.status === "in_review")}
        {chip("Concluídas", { status: "done" }, f.status === "done")}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <form className="flex flex-wrap gap-2" action="/app/tarefas">
          {f.situacao && <input type="hidden" name="situacao" value={f.situacao} />}
          {f.status && <input type="hidden" name="status" value={f.status} />}
          <select name="cliente" defaultValue={f.cliente ?? ""} aria-label="Cliente" className="h-8 rounded-md border border-border bg-surface px-2 text-[13px]">
            <option value="">Todos os clientes</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="responsavel" defaultValue={f.responsavel ?? ""} aria-label="Responsável" className="h-8 rounded-md border border-border bg-surface px-2 text-[13px]">
            <option value="">Toda a equipe</option>{active.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
          </select>
          <button type="submit" className="h-8 rounded-md border border-border px-2.5 text-[13px] hover:bg-surface-2">Filtrar</button>
        </form>
      </div>
      <Panel padded={false}>
        <TaskList tasks={tasks} members={mm} currentUser={ctx.user.id} canManage={ctx.can("tasks.manage")}
          empty={f.status ? `Nenhuma tarefa ${taskStatus[f.status].label.toLowerCase()}.` : "Nenhuma tarefa neste filtro."} />
      </Panel>
      {(count ?? 0) > page * size && (
        <div className="mt-3 flex justify-end"><Link className="text-[13px] underline" href={`/app/tarefas${qs({ ...raw }, { pagina: page + 1 })}`}>Próxima página</Link></div>
      )}
    </>
  );
}
