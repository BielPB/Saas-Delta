import Link from "next/link";
import type { MemberRow, TaskRow } from "@/lib/data";
import { deliverableKind, taskKind } from "@/lib/domain";
import { relative, formatDate } from "@/lib/format";
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
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                <span>{t.clients?.name}</span>
                {t.content_items && <span>· #{t.content_items.code}</span>}
                <span>· {taskKind[t.kind]}{t.deliverables ? ` · ${deliverableKind[t.deliverables.kind]}` : ""}</span>
                {t.due_at && <span title={formatDate(t.due_at)}>· prazo {relative(t.due_at)}</span>}
              </p>
            </div>
            <PriorityBadge p={t.priority} />
            <TaskStatusBadge t={t} />
            {showAssignee && (who ? <Avatar name={who.full_name} src={who.avatar_url} size={22} /> : <span className="text-xs text-subtle">Sem responsável</span>)}
            {(mine || canManage) && <TaskQuickActions task={{ id: t.id, status: t.status, kind: t.kind, hasDeliverable: Boolean(t.deliverable_id), contentId: t.content_id }} canManage={canManage} />}
          </li>
        );
      })}
    </ul>
  );
}
