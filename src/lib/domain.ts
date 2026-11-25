/**
 * Domain vocabulary shared by server and client. Mirrors the Postgres enums
 * in supabase/migrations/20261124000001_foundation.sql. Labels are pt-BR.
 */
export type ProductionStatus = "planned" | "in_production" | "internal_review" | "adjustments" | "done";
export type ApprovalStatus = "not_sent" | "awaiting" | "partially_approved" | "rejected" | "approved";
export type PublicationStatus = "unscheduled" | "planned" | "ready" | "scheduled" | "published" | "cancelled";
export type DeliverableKind = "script" | "raw_footage" | "video" | "cover" | "caption" | "image" | "carousel" | "other";
export type VersionStatus = "pending" | "approved" | "rejected" | "superseded";
export type TaskStatus = "blocked" | "pending" | "in_progress" | "in_review" | "done" | "reopened" | "cancelled";
export type TaskKind = "production" | "review" | "adjustment" | "general";
export type Priority = "low" | "medium" | "high" | "urgent";
export type ContentStage =
  | "planning" | "script" | "capture" | "editing" | "cover" | "caption" | "internal_review"
  | "client_approval" | "adjustments" | "ready" | "scheduled" | "published" | "cancelled";

export type Tone = "neutral" | "info" | "progress" | "warning" | "danger" | "success" | "accent";

interface Label { label: string; tone: Tone }

export const productionStatus: Record<ProductionStatus, Label> = {
  planned: { label: "Planejado", tone: "neutral" },
  in_production: { label: "Em produção", tone: "progress" },
  internal_review: { label: "Revisão interna", tone: "info" },
  adjustments: { label: "Ajustes", tone: "warning" },
  done: { label: "Concluído", tone: "success" },
};

export const approvalStatus: Record<ApprovalStatus, Label> = {
  not_sent: { label: "Não enviado", tone: "neutral" },
  awaiting: { label: "Aguardando avaliação", tone: "info" },
  partially_approved: { label: "Parcialmente aprovado", tone: "progress" },
  rejected: { label: "Reprovado", tone: "danger" },
  approved: { label: "Aprovado", tone: "success" },
};

export const publicationStatus: Record<PublicationStatus, Label> = {
  unscheduled: { label: "Sem data definida", tone: "neutral" },
  planned: { label: "Planejado", tone: "neutral" },
  ready: { label: "Pronto para publicar", tone: "accent" },
  scheduled: { label: "Agendado", tone: "info" },
  published: { label: "Publicado", tone: "success" },
  cancelled: { label: "Cancelado", tone: "neutral" },
};

export const versionStatus: Record<VersionStatus, Label> = {
  pending: { label: "Pendente", tone: "info" },
  approved: { label: "Aprovado", tone: "success" },
  rejected: { label: "Reprovado", tone: "danger" },
  superseded: { label: "Substituída", tone: "neutral" },
};

export const taskStatus: Record<TaskStatus, Label> = {
  blocked: { label: "Bloqueada", tone: "neutral" },
  pending: { label: "Pendente", tone: "info" },
  in_progress: { label: "Em andamento", tone: "progress" },
  in_review: { label: "Em revisão", tone: "accent" },
  done: { label: "Concluída", tone: "success" },
  reopened: { label: "Reaberta", tone: "warning" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};

export const taskKind: Record<TaskKind, string> = {
  production: "Produção",
  review: "Revisão interna",
  adjustment: "Ajuste",
  general: "Geral",
};

export const priority: Record<Priority, Label> = {
  low: { label: "Baixa", tone: "neutral" },
  medium: { label: "Média", tone: "info" },
  high: { label: "Alta", tone: "warning" },
  urgent: { label: "Urgente", tone: "danger" },
};

export const deliverableKind: Record<DeliverableKind, string> = {
  script: "Roteiro",
  raw_footage: "Material bruto",
  video: "Vídeo",
  cover: "Capa",
  caption: "Legenda",
  image: "Arte",
  carousel: "Carrossel",
  other: "Outro",
};

export const textKinds: DeliverableKind[] = ["script", "caption"];
export const clientFacingKinds: DeliverableKind[] = ["video", "cover", "caption", "image", "carousel"];

/** Pipeline columns in production order (briefing §12). */
export const stages: Array<{ key: ContentStage; label: string }> = [
  { key: "planning", label: "Planejamento" },
  { key: "script", label: "Roteiro" },
  { key: "capture", label: "Captação" },
  { key: "editing", label: "Edição" },
  { key: "cover", label: "Capa e arte" },
  { key: "caption", label: "Legenda" },
  { key: "internal_review", label: "Revisão interna" },
  { key: "client_approval", label: "Aprovação do cliente" },
  { key: "adjustments", label: "Ajustes" },
  { key: "ready", label: "Pronto para publicar" },
  { key: "scheduled", label: "Agendado" },
  { key: "published", label: "Publicado" },
];
export const stageLabel = Object.fromEntries(stages.map((s) => [s.key, s.label])) as Record<ContentStage, string>;
stageLabel.cancelled = "Cancelado";

export const channels: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  other: "Outro",
};

/** Calendar/editorial status, including the computed "late" condition. */
export function editorialStatus(c: {
  publication_status: PublicationStatus;
  planned_publish_at: string | null;
  scheduled_at: string | null;
}, now = new Date()): { label: string; tone: Tone; late: boolean } {
  const due = c.scheduled_at ?? c.planned_publish_at;
  const late = Boolean(due && new Date(due) < now && !["published", "cancelled"].includes(c.publication_status));
  if (late && c.publication_status === "scheduled") return { label: "Aguardando confirmação", tone: "warning", late };
  if (late) return { label: "Publicação atrasada", tone: "danger", late };
  const base = publicationStatus[c.publication_status];
  return { ...base, late };
}

export function isTaskOverdue(t: { status: TaskStatus; due_at: string | null }, now = new Date()) {
  return Boolean(t.due_at && new Date(t.due_at) < now && !["done", "cancelled", "blocked"].includes(t.status));
}

/** Allowed pipeline drops (Kanban). Anything else is rejected client-side AND server-side. */
export function stageDropAction(from: ContentStage, to: ContentStage):
  | { kind: "open_content" }
  | { kind: "schedule" }
  | { kind: "confirm" }
  | { kind: "invalid"; reason: string } {
  if (from === to) return { kind: "invalid", reason: "Mesma etapa." };
  if (to === "scheduled" && from === "ready") return { kind: "schedule" };
  if (to === "published" && (from === "scheduled" || from === "ready")) return { kind: "confirm" };
  if (["script", "capture", "editing", "cover", "caption", "internal_review", "client_approval"].includes(to)) {
    return { kind: "invalid", reason: "Etapas de produção avançam automaticamente ao concluir as tarefas e entregas." };
  }
  if (to === "ready") return { kind: "invalid", reason: "Fica pronto para publicar quando todos os entregáveis são aprovados." };
  if (to === "adjustments") return { kind: "invalid", reason: "Ajustes são abertos por reprovação do cliente ou invalidação com motivo." };
  return { kind: "invalid", reason: "Transição não permitida." };
}
