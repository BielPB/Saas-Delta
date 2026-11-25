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
