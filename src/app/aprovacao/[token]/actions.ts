"use server";
import { friendlyError } from "@/lib/errors";
import { getPortalSession, portalRpc, setPortalSession, throttle, TOKEN_RE } from "@/lib/portal";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string; code?: string };

export async function openPortalAction(token: string, pin: string | null): Promise<R<{ requiresPin?: boolean; attemptsLeft?: number }>> {
  if (!TOKEN_RE.test(token)) return { ok: false, error: friendlyError("link_unavailable"), code: "link_unavailable" };
  if (!(await throttle("portal_open", 30, 300))) return { ok: false, error: "Muitas tentativas. Aguarde alguns minutos." };
  const { data, error } = await portalRpc().rpc("portal_open", { p_token: token, p_pin: pin });
  if (error) return { ok: false, error: friendlyError(error), code: /link_unavailable/.test(error.message) ? "link_unavailable" : undefined };
  const r = data as { ok: boolean; session?: string; error?: string; attempts_left?: number; locked_until?: string };
  if (r.ok && r.session) { await setPortalSession(token, r.session); return { ok: true }; }
  if (r.error === "pin_required") return { ok: true, data: { requiresPin: true } };
  if (r.error === "pin_invalid") return { ok: false, error: `PIN incorreto. Restam ${r.attempts_left} tentativa(s).`, code: "pin_invalid" };
  if (r.error === "locked") return { ok: false, error: "Acesso bloqueado temporariamente por tentativas incorretas. Tente novamente em 15 minutos.", code: "locked" };
  return { ok: false, error: "Não foi possível abrir o link." };
}

async function session(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  return getPortalSession(token);
}

export async function respondAction(token: string, input: {
  version: string; decision: "approved" | "rejected"; comment: string | null; reviewer: string | null; key: string; override?: boolean;
}): Promise<R<{ status: string }>> {
  const s = await session(token);
  if (!s) return { ok: false, error: friendlyError("session_invalid"), code: "session_invalid" };
  if (!(await throttle("portal_write", 240, 300))) return { ok: false, error: "Muitas ações em pouco tempo. Aguarde um instante." };
  if (input.decision === "rejected" && (!input.comment || input.comment.trim().length < 3)) return { ok: false, error: friendlyError("comment_required") };
  const { data, error } = await portalRpc().rpc("portal_respond", {
    p_token: token, p_session: s, p_version: input.version, p_decision: input.decision,
    p_comment: input.comment?.slice(0, 5000) ?? null, p_reviewer_name: input.reviewer?.slice(0, 120) ?? null,
    p_idempotency_key: input.key, p_confirm_override: Boolean(input.override),
  });
  if (error) return { ok: false, error: friendlyError(error), code: /stale_version/.test(error.message) ? "stale" : /session_invalid/.test(error.message) ? "session_invalid" : undefined };
  return { ok: true, data: data as { status: string } };
}

export async function bulkApproveAction(token: string, input: { content: string | null; reviewer: string | null; key: string; includeRejected: boolean }):
  Promise<R<{ approved: number; skipped_rejected: number; unchanged: number }>> {
  const s = await session(token);
  if (!s) return { ok: false, error: friendlyError("session_invalid"), code: "session_invalid" };
  const { data, error } = await portalRpc().rpc("portal_bulk_approve", {
    p_token: token, p_session: s, p_content: input.content, p_reviewer_name: input.reviewer, p_idempotency_key: input.key, p_include_rejected: input.includeRejected,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  return { ok: true, data: data as { approved: number; skipped_rejected: number; unchanged: number } };
}

export async function finalizeAction(token: string, reviewer: string | null): Promise<R<{ approved_contents: number; adjustment_contents: number; pending_items: number; total_contents: number; received_at: string }>> {
  const s = await session(token);
  if (!s) return { ok: false, error: friendlyError("session_invalid"), code: "session_invalid" };
  const { data, error } = await portalRpc().rpc("portal_finalize", { p_token: token, p_session: s, p_reviewer_name: reviewer });
  if (error) return { ok: false, error: friendlyError(error) };
  return { ok: true, data: data as never };
}
