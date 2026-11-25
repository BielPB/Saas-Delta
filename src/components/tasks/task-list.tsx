import Link from "next/link";
import type { MemberRow, TaskRow } from "@/lib/data";
import { isTaskOverdue } from "@/lib/domain";
import { relative } from "@/lib/format";
import { Avatar, EmptyState } from "@/components/ui/primitives";
import { PriorityBadge, TaskStatusBadge } from "@/components/content/badges";
import { TaskQuickActions } from "./task-actions";

export function TaskList({ tasks, members, empty, showAssignee = true, currentUser, canManage }: {
  tasks: TaskRow[];
  members: Map<string, MemberRow>;
  empty?: string;
  showAssignee?: boolean;
  currentUser: string;
  canManage: boolean;
}) {
  if (tasks.length === 0) return <EmptyState compact title={empty ?? "Nenhuma tarefa"} />;
  return (
    <ul className="divide-y divide-border">
      {tasks.map((t) => {
        const who = t.assignee_id ? members.get(t.assignee_id) : undefined;
        const mine = t.assignee_id === currentUser;
        return (
          <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <Link href={`/app/tarefas/${t.id}`} className="block truncate text-[13px] font-medium hover:underline">{t.title}</Link>
              <p className="truncate text-xs text-muted">
                {[t.clients?.name, t.content_items ? `#${t.content_items.code}` : null, t.due_at ? `prazo ${relative(t.due_at)}` : null].filter(Boolean).join(" · ")}
              </p>
            </div>
            <PriorityBadge p={t.priority} />
            {/* "Pendente" is implied by the Iniciar button; show the status only when it adds information. */}
            {(t.status !== "pending" || !(mine || canManage) || isTaskOverdue(t)) && <TaskStatusBadge t={t} />}
            {showAssignee && (who ? <Avatar name={who.full_name} src={who.avatar_url} size={22} /> : <span className="text-xs text-subtle">Sem responsável</span>)}
            {(mine || canManage) && <TaskQuickActions task={{ id: t.id, status: t.status, kind: t.kind, hasDeliverable: Boolean(t.deliverable_id), contentId: t.content_id }} canManage={canManage} />}
          </li>
        );
      })}
    </ul>
  );
}
