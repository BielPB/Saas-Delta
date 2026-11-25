import type { Metadata } from "next";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { memberMap, taskSelect, type TaskRow } from "@/lib/data";
import { isTaskOverdue } from "@/lib/domain";
import { toLocalInput } from "@/lib/format";
import { ChevronDown } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { TaskList } from "@/components/tasks/task-list";

export const metadata: Metadata = { title: "Minhas tarefas" };

export default async function MyTasksPage() {
  const ctx = await getContext();
  const sb = await createClient();
  const [{ data: open }, { data: done }, members] = await Promise.all([
    sb.from("tasks").select(taskSelect).eq("workspace_id", ctx.workspace.id).eq("assignee_id", ctx.user.id)
      .not("status", "in", "(done,cancelled)").order("due_at", { ascending: true, nullsFirst: false }).limit(300),
    sb.from("tasks").select(taskSelect).eq("workspace_id", ctx.workspace.id).eq("assignee_id", ctx.user.id)
      .eq("status", "done").order("completed_at", { ascending: false }).limit(20),
    memberMap(ctx.workspace.id),
  ]);
  const list = (open ?? []) as unknown as TaskRow[];
  const today = toLocalInput(new Date().toISOString()).slice(0, 10);
  const isToday = (t: TaskRow) => t.due_at && toLocalInput(t.due_at).slice(0, 10) === today;

  const groups: Array<{ key: string; title: string; hint?: string; tasks: TaskRow[] }> = [
    { key: "late", title: "Atrasadas", tasks: list.filter((t) => isTaskOverdue(t)) },
    { key: "adjust", title: "Ajustes pedidos", hint: "o cliente ou a revisão pediu mudanças", tasks: list.filter((t) => t.kind === "adjustment" && !isTaskOverdue(t)) },
    { key: "today", title: "Para hoje", tasks: list.filter((t) => isToday(t) && !isTaskOverdue(t) && t.kind !== "adjustment" && t.status !== "blocked") },
    { key: "doing", title: "Em andamento", tasks: list.filter((t) => t.status === "in_progress" && !isToday(t) && !isTaskOverdue(t) && t.kind !== "adjustment") },
    { key: "review", title: "Aguardando revisão", tasks: list.filter((t) => t.status === "in_review" && !isTaskOverdue(t) && t.kind !== "adjustment") },
    { key: "next", title: "Próximas", tasks: list.filter((t) => ["pending", "reopened"].includes(t.status) && !isToday(t) && !isTaskOverdue(t) && t.kind !== "adjustment") },
  ].filter((g) => g.tasks.length > 0);
  const blocked = list.filter((t) => t.status === "blocked" && !isTaskOverdue(t));
  const doneList = (done ?? []) as unknown as TaskRow[];
  const canManage = ctx.can("tasks.manage");
  const actionable = list.length - blocked.length;

  return (
    <div className="max-w-4xl">
      <PageHeader title="Minhas tarefas"
        description={actionable === 0 ? "Tudo em dia." : `${actionable} para fazer. Use Iniciar e Concluir: ao concluir, a próxima etapa é liberada para a equipe.`} />

      {groups.length === 0 ? (
        <section className="rounded-lg border border-border bg-surface">
          <EmptyState compact title="Nenhuma tarefa para fazer agora" description={blocked.length ? "Suas próximas tarefas estão esperando etapas anteriores." : "Quando alguém te atribuir uma tarefa, ela aparece aqui."} />
        </section>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`g-${g.key}`}>
              <h2 id={`g-${g.key}`} className={cn("mb-1.5 flex items-baseline gap-2 px-1 text-[13px] font-semibold", g.key === "late" && "text-[var(--tone-danger-fg)]")}>
                {g.title} <span className="tabular text-xs font-normal text-muted">{g.tasks.length}</span>
                {g.hint && <span className="text-xs font-normal text-subtle">{g.hint}</span>}
              </h2>
              <div className={cn("rounded-lg border bg-surface", g.key === "late" ? "border-[var(--tone-danger-fg)]/30" : "border-border")}>
                <TaskList tasks={g.tasks} members={members} showAssignee={false} currentUser={ctx.user.id} canManage={canManage} />
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="mt-6 space-y-3">
        {blocked.length > 0 && (
          <Folded title="Esperando etapa anterior" count={blocked.length} hint="liberam sozinhas quando a etapa anterior for concluída">
            <TaskList tasks={blocked} members={members} showAssignee={false} currentUser={ctx.user.id} canManage={canManage} />
          </Folded>
        )}
        {doneList.length > 0 && (
          <Folded title="Concluídas recentemente" count={doneList.length}>
            <TaskList tasks={doneList} members={members} showAssignee={false} currentUser={ctx.user.id} canManage={canManage} />
          </Folded>
        )}
      </div>
    </div>
  );
}

function Folded({ title, count, hint, children }: { title: string; count: number; hint?: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-[13px] font-semibold text-muted group-open:text-fg">
          {title} <span className="tabular ml-1 font-normal">{count}</span>
          {hint && <span className="ml-2 text-xs font-normal text-subtle">{hint}</span>}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-border">{children}</div>
    </details>
  );
}
