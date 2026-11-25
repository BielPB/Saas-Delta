import type { Metadata } from "next";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { memberMap, taskSelect, type TaskRow } from "@/lib/data";
import { isTaskOverdue } from "@/lib/domain";
import { toLocalInput } from "@/lib/format";
import { PageHeader, Panel } from "@/components/ui/primitives";
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

  const groups: Array<{ key: string; title: string; tasks: TaskRow[]; empty: string }> = [
    { key: "late", title: "Atrasadas", tasks: list.filter((t) => isTaskOverdue(t)), empty: "Nada atrasado." },
    { key: "adjust", title: "Solicitações de ajuste", tasks: list.filter((t) => t.kind === "adjustment" && !isTaskOverdue(t)), empty: "Nenhum ajuste pedido." },
    { key: "today", title: "Para hoje", tasks: list.filter((t) => isToday(t) && !isTaskOverdue(t) && t.kind !== "adjustment"), empty: "Nada vence hoje." },
    { key: "doing", title: "Em andamento", tasks: list.filter((t) => t.status === "in_progress" && !isToday(t) && !isTaskOverdue(t) && t.kind !== "adjustment"), empty: "Nenhuma em andamento." },
    { key: "review", title: "Aguardando revisão", tasks: list.filter((t) => t.status === "in_review"), empty: "Nada aguardando revisão." },
    { key: "next", title: "Próximas", tasks: list.filter((t) => ["pending", "reopened"].includes(t.status) && !isToday(t) && !isTaskOverdue(t) && t.kind !== "adjustment"), empty: "Sem próximas tarefas." },
    { key: "blocked", title: "Bloqueadas por dependência", tasks: list.filter((t) => t.status === "blocked"), empty: "Nenhuma bloqueada." },
  ];

  return (
    <>
      <PageHeader title="Minhas tarefas" description={`${list.length} em aberto. Ao concluir, a próxima etapa é liberada automaticamente para quem depende de você.`} />
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <Panel key={g.key} padded={false} title={<span>{g.title} <span className="tabular ml-1 text-xs font-normal text-muted">{g.tasks.length}</span></span>}
            className={g.key === "late" && g.tasks.length ? "border-[var(--tone-danger-fg)]/30" : undefined}>
            <TaskList tasks={g.tasks} members={members} showAssignee={false} currentUser={ctx.user.id} canManage={ctx.can("tasks.manage")} empty={g.empty} />
          </Panel>
        ))}
        <Panel padded={false} title="Concluídas recentemente" className="lg:col-span-2">
          <TaskList tasks={(done ?? []) as unknown as TaskRow[]} members={members} showAssignee={false} currentUser={ctx.user.id} canManage={ctx.can("tasks.manage")} empty="Nenhuma concluída ainda." />
        </Panel>
      </div>
    </>
  );
}
