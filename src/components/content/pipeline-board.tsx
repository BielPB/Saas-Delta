"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import type { ApprovalStatus, ContentStage, DeliverableKind } from "@/lib/domain";
import { boardColumns, columnToWork } from "@/lib/board";
import { useToast } from "@/components/ui/overlay";
import { setPostStatus, submitPost } from "@/app/app/clientes/[id]/post-actions";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/primitives";
import { ApprovalBadge } from "./badges";
import { PublicationDialog } from "./publication-dialog";

export interface BoardItem {
  id: string; code: number; title: string; client: string; stage: ContentStage; approval: ApprovalStatus;
  thumb: string | null; aspect: string | null; planned: string | null; service: { name: string; color: string } | null;
  format?: string; deliverables?: Array<{ kind: DeliverableKind; done: boolean }>; assignee?: { name: string; avatar: string | null } | null;
  /** Board column (see lib/board columnOf); falls back to the stage. */
  column?: string; clientId?: string; movable?: boolean; href?: string;
}


const kindLabel: Record<string, string> = { video: "Vídeo", cover: "Capa", caption: "Legenda", image: "Arte", carousel: "Carrossel", other: "Material" };

const readyNote = (i: BoardItem) =>
  i.stage === "client_approval" ? "Na aprovação" : i.stage === "adjustments" ? "Em ajustes" : i.stage === "ready" ? "Pronto para publicar"
    : i.stage === "scheduled" ? "Agendado" : i.stage === "published" ? "Publicado" : "";

export function PipelineBoard({ items, canPublish, canSubmit = false }: { items: BoardItem[]; canPublish: boolean; canSubmit?: boolean }) {
  const [dialog, setDialog] = useState<{ mode: "schedule" | "confirm"; item: BoardItem } | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const colOf = (i: BoardItem) => i.column ?? boardColumns.find((c) => c.stages.includes(i.stage))?.key ?? "script";

  /** Drag to a production column = change the post status; drop on "Pronto" = release to the client. */
  const onDrop = (to: string) => {
    const item = items.find((x) => x.id === drag);
    setDrag(null); setOver(null);
    if (!item || colOf(item) === to) return;
    if (!item.movable || !item.clientId) { toast.info("Este conteúdo segue as etapas de tarefas: ele avança quando as tarefas são concluídas."); return; }
    if (colOf(item) === "ready") { toast.info("Este post já está com o cliente ou aprovado."); return; }
    start(async () => {
      const r = to === "ready"
        ? (canSubmit ? await submitPost(item.id, item.clientId!) : { ok: false, error: "Você não tem permissão para liberar posts ao cliente." })
        : await setPostStatus(item.id, item.clientId!, columnToWork[to]);
      if (r.ok) { toast.success(to === "ready" ? "Liberado para aprovação." : "Status atualizado."); router.refresh(); }
      else toast.error(r.error ?? "Não foi possível mover.");
    });
  };

  return (
    <>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8" aria-label="Pipeline de produção">
        {boardColumns.map((col) => {
          const list = items.filter((i) => colOf(i) === col.key);
          return (
            <section key={col.key} aria-label={`${col.label}: ${list.length}`} aria-busy={pending}
              onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(col.key); } }} onDragLeave={() => setOver(null)} onDrop={() => onDrop(col.key)}
              className={cn("flex w-[19rem] shrink-0 flex-col gap-3 rounded-xl transition-colors", over === col.key && drag && "bg-accent/10 ring-2 ring-accent-ink/40")}>
              <header className={cn(
                "flex items-center justify-between rounded-xl border-2 px-4 py-2.5",
                col.ready ? "border-accent bg-accent text-accent-fg" : "border-accent-ink/70 text-fg",
              )}>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-extrabold uppercase leading-tight tracking-wide">{col.label}</h3>
                  <p className={cn("truncate text-xs", col.ready ? "text-accent-fg/80" : "text-muted")}>{col.hint}</p>
                </div>
                <span className={cn("tabular flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold",
                  col.ready ? "border-accent-fg/60" : "border-accent-ink/70")}>{list.length}</span>
              </header>

              <ul className="flex min-h-24 flex-col gap-3">
                {list.map((i) => (
                  <li key={i.id} draggable={Boolean(i.movable)} onDragStart={() => setDrag(i.id)} onDragEnd={() => { setDrag(null); setOver(null); }}
                    className={cn("rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong", i.movable && "cursor-grab active:cursor-grabbing", drag === i.id && "opacity-50")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full border border-border-strong px-2.5 py-0.5 text-xs font-semibold">{i.format ?? "Conteúdo"}</span>
                      <span className="tabular text-xs text-muted">
                        {col.ready && readyNote(i) ? readyNote(i) : i.planned ? formatDate(i.planned) : ""}
                      </span>
                    </div>
                    <Link href={i.href ?? `/app/conteudos/${i.id}`} draggable={false} className="mt-3 block text-[17px] font-bold leading-snug tracking-tight hover:underline">
                      {i.title}
                    </Link>

                    {(i.deliverables?.length ?? 0) > 0 && (
                      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Entregáveis">
                        {i.deliverables!.map((d, n) => (
                          <li key={`${d.kind}-${n}`} className={cn(
                            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold",
                            d.done ? "bg-accent text-accent-fg" : "border border-dashed border-accent-ink/70 text-fg",
                          )}>
                            {d.done && <Check className="size-3" strokeWidth={3} aria-hidden />}
                            {kindLabel[d.kind] ?? d.kind}
                            <span className="sr-only">{d.done ? " (entregue)" : " (pendente)"}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                      {i.assignee ? (
                        <span className="flex min-w-0 items-center gap-2 text-sm">
                          <Avatar name={i.assignee.name} src={i.assignee.avatar} size={28} className="border-2 border-accent-ink/70 bg-transparent font-bold text-fg" />
                          <span className="truncate">{i.assignee.name.split(" ")[0]}</span>
                        </span>
                      ) : <span className="text-xs text-subtle">Sem responsável</span>}
                      {["client_approval", "adjustments"].includes(i.stage) && <ApprovalBadge s={i.approval} />}
                    </div>

                    {(i.stage === "ready" || i.stage === "scheduled") && canPublish && (
                      <button type="button" className="mt-2 text-xs font-semibold text-accent-ink underline-offset-2 hover:underline"
                        onClick={() => setDialog({ mode: i.stage === "ready" ? "schedule" : "confirm", item: i })}>
                        {i.stage === "ready" ? "Registrar agendamento" : "Confirmar publicação"}
                      </button>
                    )}
                  </li>
                ))}
                {list.length === 0 && (
                  <li className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-subtle">Nenhum conteúdo</li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
      {dialog && (
        <PublicationDialog mode={dialog.mode} onClose={() => setDialog(null)} defaults={{ at: dialog.item.planned }}
          content={{ id: dialog.item.id, label: `#${dialog.item.code} ${dialog.item.title}`, approved: dialog.item.approval === "approved" }} />
      )}
    </>
  );
}
