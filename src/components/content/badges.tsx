import { Badge } from "@/components/ui/primitives";
import {
  approvalStatus, editorialStatus, priority, productionStatus, stageLabel, taskStatus, versionStatus, isTaskOverdue,
  type ApprovalStatus, type ContentStage, type Priority, type ProductionStatus, type PublicationStatus, type TaskStatus, type VersionStatus,
} from "@/lib/domain";

export function ApprovalBadge({ s }: { s: ApprovalStatus }) {
  return <Badge tone={approvalStatus[s].tone}>{approvalStatus[s].label}</Badge>;
}
export function ProductionBadge({ s }: { s: ProductionStatus }) {
  return <Badge tone={productionStatus[s].tone}>{productionStatus[s].label}</Badge>;
}
export function PublicationBadge({ c }: { c: { publication_status: PublicationStatus; planned_publish_at: string | null; scheduled_at: string | null } }) {
  const e = editorialStatus(c);
  return <Badge tone={e.tone} dot={e.late}>{e.label}</Badge>;
}
export function StageBadge({ s }: { s: ContentStage }) {
  const tone = s === "ready" ? "accent" : s === "published" ? "success" : s === "adjustments" ? "warning" : s === "client_approval" ? "info" : "neutral";
  return <Badge tone={tone}>{stageLabel[s]}</Badge>;
}
export function TaskStatusBadge({ t }: { t: { status: TaskStatus; due_at: string | null } }) {
  const late = isTaskOverdue(t);
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={taskStatus[t.status].tone}>{taskStatus[t.status].label}</Badge>
      {late && <Badge tone="danger" dot>Atrasada</Badge>}
    </span>
  );
}
export function PriorityBadge({ p }: { p: Priority }) {
  if (p === "medium" || p === "low") return null;
  return <Badge tone={priority[p].tone}>{priority[p].label}</Badge>;
}
export function VersionBadge({ s }: { s: VersionStatus }) {
  return <Badge tone={versionStatus[s].tone}>{versionStatus[s].label}</Badge>;
}
export function ServiceDot({ color, name }: { color?: string | null; name?: string | null }) {
  if (!name) return <span className="text-subtle">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
      <span className="size-2 shrink-0 rounded-full" style={{ background: color ?? "#737373" }} aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}
