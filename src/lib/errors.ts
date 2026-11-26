/**
 * Maps database error contracts (see 0005_workflow.sql header) to clear pt-BR
 * messages. Never leaks SQL details to the user.
 */
const messages: Array<[RegExp, string]> = [
  [/permission_denied|42501|row-level security|permission denied/i, "Você não tem permissão para esta ação."],
  [/not_found/i, "Registro não encontrado ou sem acesso."],
  [/dependencies_pending/i, "Esta tarefa depende de etapas que ainda não foram concluídas."],
  [/deliverable_missing/i, "Envie o entregável obrigatório (arquivo, link ou texto) antes de concluir."],
  [/adjustments_pending/i, "Há ajustes em aberto. Conclua-os antes de finalizar a revisão."],
  [/not_reviewed/i, "Alguns conteúdos ainda não passaram pela revisão interna."],
  [/comment_required/i, "Escreva uma justificativa (mínimo de 3 caracteres)."],
  [/stale_version/i, "Esta versão foi substituída. Atualize a página para ver a versão mais recente."],
  [/approval_required/i, "O conteúdo precisa estar aprovado. Para exceções, informe o motivo (requer permissão)."],
  [/link_unavailable/i, "Este link expirou ou foi revogado. Peça um novo link à agência."],
  [/session_invalid/i, "Sua sessão no link expirou. Recarregue a página."],
  [/pin_required/i, "Este cliente exige PIN no link de aprovação."],
  [/sensitive_expiry/i, "Para materiais sensíveis, a validade máxima do link é de 30 dias."],
  [/slug_taken/i, "Este endereço já está em uso. Escolha outro."],
  [/already_member/i, "Esta pessoa já faz parte do workspace."],
  [/content_published/i, "Conteúdo já publicado não pode ser alterado."],
  [/batch_closed/i, "Este lote de aprovação foi encerrado."],
  [/invalid_transition/i, "Essa mudança de status não é permitida no estado atual."],
  [/workspace needs at least one owner/i, "O workspace precisa de pelo menos um proprietário."],
  [/validation/i, "Confira os dados informados."],
  [/duplicate key|unique/i, "Já existe um registro com esses dados."],
  [/foreign key/i, "Referência inválida."],
];

export function friendlyError(err: unknown): string {
  const raw = typeof err === "string" ? err : err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "";
  for (const [re, msg] of messages) if (re.test(raw)) return msg;
  return "Não foi possível concluir a ação. Tente novamente.";
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const fail = (error: unknown, fieldErrors?: Record<string, string>): ActionResult<never> => ({
  ok: false,
  // Plain sentences are shown as-is; error codes ("permission_denied: x", "slug_taken") are translated.
  error: typeof error === "string" && !/^[a-z0-9]+(?:_[a-z0-9]+)*(?::|\s*$)/.test(error) ? error : friendlyError(error),
  fieldErrors,
});
