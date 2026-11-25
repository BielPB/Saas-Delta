import type { ApprovalStatus, ContentStage, PublicationStatus } from "@/lib/domain";

/**
 * One status per post, as the team sees it.
 * planning / production / review are set by hand (work_status);
 * everything from "with the client" on is derived from approval and publication.
 */
export type WorkStatus = "planning" | "production" | "review";
export type PostStatusKey = WorkStatus | "client" | "adjust" | "ready" | "scheduled" | "published" | "cancelled";
export type Tone = "neutral" | "info" | "progress" | "warning" | "danger" | "success" | "accent";

export const manualStatuses: Array<{ key: WorkStatus; label: string }> = [
  { key: "planning", label: "Planejamento" },
  { key: "production", label: "Em produção" },
  { key: "review", label: "Revisão" },
];

export const postStatusMeta: Record<PostStatusKey, { label: string; tone: Tone; hint: string }> = {
  planning: { label: "Planejamento", tone: "neutral", hint: "Ideia, briefing e roteiro." },
  production: { label: "Em produção", tone: "progress", hint: "Gravação, edição, arte e legenda." },
  review: { label: "Revisão", tone: "info", hint: "Conferência interna antes de enviar ao cliente." },
  client: { label: "Com o cliente", tone: "info", hint: "Aguardando a aprovação no link." },
  adjust: { label: "Em ajuste", tone: "warning", hint: "O cliente pediu mudanças." },
  ready: { label: "Pronto para publicar", tone: "accent", hint: "Aprovado pelo cliente." },
  scheduled: { label: "Agendado", tone: "accent", hint: "Programado na rede social." },
  published: { label: "Publicado", tone: "success", hint: "Já foi ao ar." },
  cancelled: { label: "Cancelado", tone: "neutral", hint: "" },
};

export function postStatus(c: { work_status?: string | null; stage: ContentStage; approval_status: ApprovalStatus; publication_status: PublicationStatus }): PostStatusKey {
  if (c.publication_status === "cancelled" || c.stage === "cancelled") return "cancelled";
  if (c.publication_status === "published") return "published";
  if (c.publication_status === "scheduled") return "scheduled";
  if (c.stage === "ready" || c.publication_status === "ready") return "ready";
  if (c.stage === "adjustments") return "adjust";
  if (["awaiting", "partially_approved", "rejected"].includes(c.approval_status)) return "client";
  const w = c.work_status as WorkStatus | undefined;
  return w === "production" || w === "review" ? w : "planning";
}

/** Formats grouped the way the agency thinks about them (tabs on the client page). */
export const formatGroups: Array<{ key: "posts" | "reels" | "stories"; label: string; formats: string[] }> = [
  { key: "posts", label: "Posts", formats: ["static_post", "carousel"] },
  { key: "reels", label: "Reels", formats: ["reels", "youtube", "institutional", "ad", "paid_creative"] },
  { key: "stories", label: "Stories", formats: ["stories"] },
];
