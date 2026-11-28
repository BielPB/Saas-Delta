"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Check } from "lucide-react";
import type { ApprovalStatus, ContentStage, DeliverableKind } from "@/lib/domain";
import { boardColumns, columnToWork } from "@/lib/board";
import { NewPostButton, type NewPostOptions } from "./new-post-button";
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

export function PipelineBoard({ items, canPublish, canSubmit = false, create }: { items: BoardItem[]; canPublish: boolean; canSubmit?: boolean; create?: NewPostOptions }) {
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
    if (item) move(item, to);
  };
  /** Same move, from drag and drop or from the "Mover" menu (touch screens have no drag). */
  const move = (item: BoardItem, to: string) => {
    if (colOf(item) === to) return;
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
      {/* Phones: one column per screen with a peek of the next, snapping as you swipe. */}
      <div role="region" aria-label="Pipeline de produção" tabIndex={0}
        className="grid max-h-[max(45dvh,calc(100dvh-23rem))] grid-flow-col auto-cols-[min(19rem,calc(100vw-3.5rem))] grid-rows-[max-content] snap-x snap-proximity gap-3 overflow-auto overscroll-x-contain pb-2 sm:snap-none">
        {boardColumns.map((col) => {
          const list = items.filter((i) => colOf(i) === col.key);
          return (
            <section key={col.key} aria-label={`${col.label}: ${list.length}`} aria-busy={pending}
              onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(col.key); } }} onDragLeave={() => setOver(null)} onDrop={() => onDrop(col.key)}
              className={cn("flex min-w-0 snap-start flex-col gap-3 rounded-xl transition-colors", over === col.key && drag && "bg-accent/10 ring-2 ring-accent-ink/40")}>
              <header className={cn(
                "sticky top-0 z-10 flex items-center justify-between rounded-xl border-2 px-4 py-2.5",
                col.ready ? "border-accent bg-accent text-accent-fg" : "border-accent-ink/70 bg-bg text-fg",
              )}>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-extrabold uppercase leading-tight tracking-wide">{col.label}</h3>
                  <p className={cn("wrap-anywhere whitespace-normal text-xs", col.ready ? "text-accent-fg/80" : "text-muted")}>{col.hint}</p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5">
                  {create && !col.ready && <NewPostButton options={create} stage={columnToWork[col.key]} iconOnly />}
                  <span className={cn("tabular flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold",
                    col.ready ? "border-accent-fg/60" : "border-accent-ink/70")}>{list.length}</span>
                </span>
              </header>

              <ul className="flex min-h-24 flex-col gap-3">
                {list.map((i) => (
                  <li key={i.id} draggable={Boolean(i.movable)} onDragStart={() => setDrag(i.id)} onDragEnd={() => { setDrag(null); setOver(null); }}
                    className={cn("rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong", i.movable && "cursor-grab active:cursor-grabbing", drag === i.id && "opacity-50")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="wrap-anywhere whitespace-normal rounded-full border border-border-strong px-2.5 py-0.5 text-xs font-semibold">{i.format ?? "Conteúdo"}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        <span className="tabular text-xs text-muted">
                          {col.ready && readyNote(i) ? readyNote(i) : i.planned ? formatDate(i.planned) : ""}
                        </span>
                        {i.movable && i.clientId && !col.ready && (
                          // Native picker: opens as the phone's own sheet and is never clipped by the scrolling board.
                          <label className="relative -mr-2 hidden size-9 items-center justify-center rounded-md text-muted pointer-coarse:inline-flex">
                            <ArrowRightLeft className="size-4" aria-hidden />
                            <select aria-label={`Mover ${i.title}`} value="" disabled={pending} className="absolute inset-0 cursor-pointer opacity-0"
                              onChange={(e) => { if (e.target.value) move(i, e.target.value); }}>
                              <option value="">Mover para…</option>
                              {boardColumns.filter((c) => c.key !== col.key && (!c.ready || canSubmit)).map((c) => (
                                <option key={c.key} value={c.key}>{c.ready ? "Pronto (liberar para o cliente)" : c.label}</option>
                              ))}
                            </select>
                          </label>
                        )}
                      </span>
                    </div>
                    <Link href={i.href ?? `/app/conteudos/${i.id}`} draggable={false} className="mt-3 block break-words text-base font-bold leading-snug tracking-tight hover:underline sm:text-[17px]">
                      {i.title}
                    </Link>

                    {(i.deliverables?.length ?? 0) > 0 && (
                      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Entregáveis">
                        {i.deliverables!.map((d, n) => (
                          <li key={`${d.kind}-${n}`} className={cn(
                            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold",
                            d.done ? "bg-accent text-accent-fg" : "border border-dashed border-accent-ink/70 bg-bg text-fg",
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
                          <span className="wrap-anywhere whitespace-normal">{i.assignee.name}</span>
                        </span>
                      ) : <span className="text-xs text-subtle">Sem responsável</span>}
                      {colOf(i) === "ready" && ["client_approval", "adjustments"].includes(i.stage) && <ApprovalBadge s={i.approval} />}
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
                  <li className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-subtle">
                    {col.ready ? "Posts liberados para o cliente aparecem aqui." : drag ? "Solte aqui" : <>Nenhum post nesta etapa.<br />
                      <span className="pointer-coarse:hidden">Arraste um card para cá{create ? " ou use o +" : ""}.</span>
                      <span className="hidden pointer-coarse:inline">Use o botão de mover no card{create ? " ou o +" : ""}.</span></>}
                  </li>
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
