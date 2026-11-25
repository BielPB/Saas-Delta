import { deliverableKind, type DeliverableKind } from "@/lib/domain";

/** Human sentence for an activity_logs row (pt-BR). */
export function activityText(action: string, data: Record<string, unknown> = {}): string {
  const kind = data.kind ? deliverableKind[data.kind as DeliverableKind]?.toLowerCase() : "entregável";
  switch (action) {
    case "content.created": return `criou o conteúdo “${data.title ?? ""}”`;
    case "content.duplicated": return "duplicou um conteúdo";
    case "content.status_set": return `mudou o status para “${({ script: "Roteiro", capture: "Gravação", editing: "Edição", finishing: "Finalização", planning: "Roteiro", production: "Edição", review: "Finalização" } as Record<string, string>)[String(data.status)] ?? data.status}”`;
    case "content.submitted": return "liberou o post para aprovação do cliente";
    case "content.cancelled": return "cancelou o conteúdo";
    case "task.started": return "iniciou uma tarefa";
    case "task.completed": return "concluiu uma tarefa";
    case "task.released": return "teve uma tarefa liberada automaticamente";
    case "task.sent_to_review": return "enviou uma tarefa para revisão";
    case "task.reopened": return `reabriu uma tarefa: ${data.reason ?? ""}`;
    case "task.cancelled": return "cancelou uma tarefa";
    case "version.created": return `enviou ${kind} V${data.version ?? ""}${data.reason ? ` (${data.reason})` : ""}`;
    case "approval.batch_created": return `gerou link de aprovação “${data.name ?? ""}” com ${data.contents ?? 0} conteúdo(s)`;
    case "approval.approved": return `aprovou ${kind} V${data.version ?? ""}`;
    case "approval.rejected": return `reprovou ${kind} V${data.version ?? ""}: “${data.comment ?? ""}”`;
    case "approval.invalidated": return `invalidou a aprovação: ${data.reason ?? ""}`;
    case "approval.batch_submitted": return "finalizou a avaliação do lote";
    case "publication.scheduled": return data.override ? "agendou a publicação (exceção autorizada)" : "registrou o agendamento";
    case "publication.rescheduled": return "reprogramou a publicação";
    case "publication.planned": return "alterou a data editorial";
    case "publication.unscheduled": return "removeu o agendamento";
    case "publication.confirmed": return "confirmou a publicação";
    default: return action;
  }
}
