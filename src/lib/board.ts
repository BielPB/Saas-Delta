import type { ContentStage } from "@/lib/domain";

/**
 * Cinco colunas de produção, agrupando as etapas internas do domínio. As etapas
 * continuam sendo derivadas de tarefas e entregas (não há arrastar para mudar
 * de coluna); agendar e confirmar publicação são botões no card, validados no servidor.
 */
export const boardColumns: Array<{ key: string; label: string; hint: string; stages: ContentStage[]; ready?: boolean }> = [
  { key: "script", label: "Roteiro", hint: "Em desenvolvimento", stages: ["planning", "script"] },
  { key: "capture", label: "Gravação", hint: "Para gravar", stages: ["capture"] },
  { key: "editing", label: "Edição", hint: "Para editar", stages: ["editing"] },
  { key: "finish", label: "Finalização", hint: "Capa, legenda e revisão", stages: ["cover", "caption", "internal_review"] },
  { key: "ready", label: "Pronto", hint: "Vai direto para a aprovação", stages: ["client_approval", "adjustments", "ready", "scheduled", "published"], ready: true },
];

import { postStatus, type WorkStatus } from "@/lib/post-status";
import type { ApprovalStatus, PublicationStatus } from "@/lib/domain";

/** Board column of a post: manual status until it goes to the client; template posts keep the task-derived stage. */
export function columnOf(c: { stage: ContentStage; approval_status: ApprovalStatus; publication_status: PublicationStatus; work_status?: string | null; template_id?: string | null }): string {
  const s = postStatus(c);
  if (["client", "adjust", "ready", "scheduled", "published"].includes(s)) return "ready";
  if (c.template_id) return boardColumns.find((col) => col.stages.includes(c.stage))?.key ?? "script";
  return ({ script: "script", capture: "capture", editing: "editing", finishing: "finish" } as Record<WorkStatus, string>)[s as WorkStatus] ?? "script";
}
export const columnToWork: Record<string, WorkStatus> = { script: "script", capture: "capture", editing: "editing", finish: "finishing" };
