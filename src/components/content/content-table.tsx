import Link from "next/link";
import { Film, ImageIcon } from "lucide-react";
import type { ContentRow } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { channels } from "@/lib/domain";
import { Table } from "@/components/ui/primitives";
import { ApprovalBadge, PriorityBadge, PublicationBadge, ServiceDot, StageBadge } from "./badges";

export function Thumb({ url, aspect, className = "w-9" }: { url: string | null; aspect?: string | null; className?: string }) {
  const ratio = aspect === "16:9" ? "16/9" : aspect === "1:1" ? "1/1" : aspect === "4:5" ? "4/5" : "9/16";
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-surface-2 text-subtle ${className}`} style={{ aspectRatio: ratio }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL; never pass private media through the shared image optimizer cache
        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
      ) : aspect === "4:5" || aspect === "1:1" ? <ImageIcon className="size-3.5" aria-hidden /> : <Film className="size-3.5" aria-hidden />}
    </span>
  );
}

/** Dense table view. `selectable` renders checkboxes bound to a form id for bulk actions. */
export function ContentTable({ rows, thumb, selectable, formId, showClient = true }: {
  rows: ContentRow[];
  thumb: (r: ContentRow) => string | null;
  selectable?: boolean;
  formId?: string;
  showClient?: boolean;
}) {
  return (
    <Table>
      <thead>
        <tr>
          {selectable && <th className="w-8"><span className="sr-only">Selecionar</span></th>}
          <th>Conteúdo</th>
          {showClient && <th className="hidden md:table-cell">Cliente</th>}
          <th className="hidden lg:table-cell">Subdivisão</th>
          <th>Etapa</th>
          <th className="hidden sm:table-cell">Aprovação</th>
          <th className="hidden xl:table-cell">Publicação</th>
          <th className="hidden md:table-cell">Postagem</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            {selectable && (
              <td><input type="checkbox" name="ids" value={r.id} form={formId} aria-label={`Selecionar #${r.code}`} className="size-4 accent-[var(--fg)]" /></td>
            )}
            <td className="max-w-[340px]">
              <Link href={`/app/conteudos/${r.id}`} className="flex items-center gap-2.5">
                <Thumb url={thumb(r)} aspect={r.content_formats?.aspect_ratio} className="w-7" />
                <span className="min-w-0">
                  <span className="block truncate font-medium hover:underline">
                    <span className="font-mono text-xs text-subtle">#{r.code}</span> {r.title}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    {r.content_formats?.name}{r.channel ? ` · ${channels[r.channel]}` : ""} <PriorityBadge p={r.priority} />
                  </span>
                </span>
              </Link>
            </td>
            {showClient && <td className="hidden text-muted md:table-cell">{r.clients?.name}</td>}
            <td className="hidden lg:table-cell"><ServiceDot color={r.client_services?.color} name={r.client_services?.name} /></td>
            <td><StageBadge s={r.stage} /></td>
            <td className="hidden sm:table-cell"><ApprovalBadge s={r.approval_status} /></td>
            <td className="hidden xl:table-cell"><PublicationBadge c={r} /></td>
            <td className="tabular hidden text-muted md:table-cell">{formatDate(r.scheduled_at ?? r.planned_publish_at)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
