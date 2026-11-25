import type { ApprovalStatus, ContentStage, PublicationStatus } from "@/lib/domain";

/**
 * One status per post, as the team sees it.
 * The production columns of the board are set by hand (work_status):
 * Roteiro → Gravação → Edição → Finalização. From "with the client" on it is
 * derived from approval and publication.
 */
export type WorkStatus = "script" | "capture" | "editing" | "finishing";
export const WORK_STATUSES: WorkStatus[] = ["script", "capture", "editing", "finishing"];
export const isWorkStatus = (v: unknown): v is WorkStatus => typeof v === "string" && (WORK_STATUSES as string[]).includes(v);
export type PostStatusKey = WorkStatus | "client" | "adjust" | "ready" | "scheduled" | "published" | "cancelled";
export type Tone = "neutral" | "info" | "progress" | "warning" | "danger" | "success" | "accent";

export const manualStatuses: Array<{ key: WorkStatus; label: string }> = [
  { key: "script", label: "Roteiro" },
  { key: "capture", label: "Gravação" },
  { key: "editing", label: "Edição" },
  { key: "finishing", label: "Finalização" },
];

export const postStatusMeta: Record<PostStatusKey, { label: string; tone: Tone; hint: string }> = {
  script: { label: "Roteiro", tone: "neutral", hint: "Ideia, briefing e roteiro." },
  capture: { label: "Gravação", tone: "progress", hint: "Captação de vídeo ou fotos." },
  editing: { label: "Edição", tone: "progress", hint: "Edição do vídeo ou da arte." },
  finishing: { label: "Finalização", tone: "info", hint: "Capa, legenda e revisão interna antes do cliente." },
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
  return isWorkStatus(c.work_status) ? c.work_status : "script";
}

/** Formats grouped the way the agency thinks about them (tabs on the client page). */
export const formatGroups: Array<{ key: "posts" | "reels" | "stories"; label: string; formats: string[] }> = [
  { key: "posts", label: "Posts", formats: ["static_post", "carousel"] },
  { key: "reels", label: "Reels", formats: ["reels", "youtube", "institutional", "ad", "paid_creative"] },
  { key: "stories", label: "Stories", formats: ["stories"] },
];
