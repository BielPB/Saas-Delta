"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/overlay";
import { Avatar } from "@/components/ui/primitives";
import { isWorkStatus, manualStatuses, postStatusMeta, type PostStatusKey, type WorkStatus } from "@/lib/post-status";
import { relative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ContentViewer, type ViewerDeliverable } from "@/app/app/conteudos/[id]/viewer";
import { CommentBox, DeliverablesManager, type DeliverableItem } from "@/app/app/conteudos/[id]/panels";
import { setAssignees, updateContent } from "@/app/app/conteudos/actions";
import { setEditor, setPostStatus, submitPost } from "./post-actions";
import { StatusPill } from "./post-grid";
import { NewTaskButton } from "@/app/app/tarefas/new-task";

export interface DrawerPost {
  id: string; code: number; number: number; title: string; clientId: string; lock: number; status: PostStatusKey; work: WorkStatus;
  format: string; aspect: string; planned: string; serviceId: string | null; briefing: string; editorId: string | null; assignees: string[];
}

export function PostDrawer({ post, viewer, managerItems, missing, adjust, tasks, canTask, comments, members, services, canEdit, canSubmit, workspaceId, closeHref, prevHref, nextHref }: {
  post: DrawerPost; viewer: ViewerDeliverable[];
  managerItems: DeliverableItem[];
  missing: string[]; adjust: string[];
  tasks: Array<{ id: string; title: string; status: string; due: string | null; who: string | null; whoAvatar: string | null }>; canTask: boolean;
  comments: Array<{ id: string; body: string; at: string; author: string; avatar: string | null }>;
  members: Array<{ id: string; name: string; avatar: string | null }>; services: Array<{ id: string; name: string }>;
  canEdit: boolean; canSubmit: boolean; workspaceId: string; closeHref: string; prevHref: string | null; nextHref: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [briefing, setBriefing] = useState(post.briefing);
  const [title, setTitle] = useState(post.title);
  const close = () => router.push(closeHref, { scroll: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) router.push(closeHref, { scroll: false });
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [closeHref, router]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const r = await fn();
    if (r.ok) { if (r.message) toast.success(r.message); router.refresh(); } else toast.error(r.error ?? "Não foi possível salvar.");
  });
  const save = (patch: Parameters<typeof updateContent>[2]) => run(() => updateContent(post.id, post.lock, patch));
  const manual = isWorkStatus(post.status);
  const meta = postStatusMeta[post.status];
  const people = new Map(members.map((m) => [m.id, m]));

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Post ${post.number}: ${post.title}`}>
      <button type="button" className="absolute inset-0 bg-[var(--overlay)]" aria-label="Fechar" onClick={close} />
      <div className="relative flex h-full w-full max-w-5xl flex-col overflow-hidden border-l border-border bg-bg shadow-pop max-sm:border-l-0">
        {/* Full screen on phones: keep the bar below the clock/notch of the installed app. */}
        <header className="flex items-start justify-between gap-2 border-b border-border px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:gap-3 sm:px-5 sm:py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">Post {String(post.number).padStart(2, "0")} <span className="font-mono text-subtle">#{post.code}</span></p>
            {canEdit ? (
              <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== post.title && save({ title: title.trim() })}
                aria-label="Título" className="mt-0.5 w-full min-w-0 bg-transparent text-lg font-bold tracking-tight outline-none focus:underline focus:decoration-border-strong sm:text-xl" />
            ) : <h2 className="mt-0.5 break-words text-lg font-bold tracking-tight sm:text-xl">{post.title}</h2>}
          </div>
          <div className="-mr-1.5 flex shrink-0 items-center sm:mr-0 sm:gap-1">
            {prevHref ? <Link href={prevHref} scroll={false} aria-label="Post anterior" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg pointer-coarse:size-10"><ChevronLeft className="size-4" /></Link> : null}
            {nextHref ? <Link href={nextHref} scroll={false} aria-label="Próximo post" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg pointer-coarse:size-10"><ChevronRight className="size-4" /></Link> : null}
            <Link href={`/app/conteudos/${post.id}`} aria-label="Abrir página completa" title="Abrir página completa" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg pointer-coarse:size-10"><ExternalLink className="size-4" /></Link>
            <button type="button" onClick={close} aria-label="Fechar" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg pointer-coarse:size-10"><X className="size-4" /></button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto overscroll-contain lg:grid-cols-[minmax(0,1fr)_300px] lg:overflow-hidden">
          {/* Left: what is being made */}
          <div className="min-w-0 space-y-6 p-4 sm:p-5 lg:overflow-y-auto">
            <Block title="Mídia e legenda">
              <ContentViewer deliverables={viewer} aspect={post.aspect} />
              <details className="group mt-3 rounded-lg border border-border bg-surface">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 px-4 py-2.5 text-[13px] font-medium pointer-coarse:py-3 [&::-webkit-details-marker]:hidden">
                  Enviar ou substituir arquivos <span className="text-xs text-muted group-open:hidden">imagens, vídeo (link do Drive), legenda</span>
                </summary>
                <div className="border-t border-border">
                  <DeliverablesManager bare contentId={post.id} workspaceId={workspaceId} clientId={post.clientId} serviceId={post.serviceId}
                    canInvalidate={false} me="" deliverables={managerItems} />
                </div>
              </details>
            </Block>

            <Block title="Briefing">
              {canEdit ? (
                <>
                  <Textarea rows={4} value={briefing} onChange={(e) => setBriefing(e.target.value)} placeholder="Objetivo, referências, o que não pode faltar…" />
                  {briefing !== post.briefing && <div className="mt-2 flex justify-end"><Button size="sm" variant="primary" disabled={pending} onClick={() => save({ briefing })}>Salvar briefing</Button></div>}
                </>
              ) : <p className="whitespace-pre-wrap text-[13px]">{post.briefing || <span className="text-muted">Sem briefing.</span>}</p>}
            </Block>

            <Block title={`Comentários da equipe${comments.length ? ` · ${comments.length}` : ""}`}>
              <ul className="mb-3 space-y-3">
                {comments.length === 0 && <li className="text-[13px] text-muted">Nenhum comentário ainda.</li>}
                {comments.map((c) => (
                  <li key={c.id} className="flex gap-2.5">
                    <Avatar name={c.author} src={c.avatar} size={26} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs"><span className="font-medium">{c.author}</span> <span className="text-subtle">{relative(c.at)}</span></p>
                      <p className="whitespace-pre-wrap text-[13px]">{c.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <CommentBox contentId={post.id} />
            </Block>
          </div>

          {/* Right: who, when, where */}
          <aside className="space-y-5 border-t border-border bg-surface/50 p-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:p-5 lg:overflow-y-auto lg:border-l lg:border-t-0">
            <Field label="Status">
              {manual && canEdit ? (
                <Select value={post.work} disabled={pending} onChange={(e) => run(() => setPostStatus(post.id, post.clientId, e.target.value as WorkStatus))}>
                  {manualStatuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </Select>
              ) : <StatusPill s={post.status} className="text-xs" />}
              <p className="mt-1 text-xs text-muted">{meta.hint}</p>
            </Field>

            {canSubmit && (manual || post.status === "adjust") && (
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-[13px] font-medium">{post.status === "adjust" ? "Ajuste pronto?" : "Pronto para o cliente?"}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {adjust.length ? `Envie a nova versão de ${adjust.join(" e ")} (o cliente pediu ajuste). Use “Enviar ou substituir arquivos”.`
                    : missing.length ? `Falta enviar: ${missing.join(", ")}.` : "Libera a versão atual para o link de aprovação do cliente."}
                </p>
                <Button size="sm" variant="primary" className="mt-2 w-full" disabled={pending || missing.length > 0 || adjust.length > 0} onClick={() => run(() => submitPost(post.id, post.clientId))}>
                  {pending ? <Loader2 className="animate-spin" /> : <Send />} Liberar para aprovação
                </Button>
              </div>
            )}

            <Field label="Tarefas deste post" hint="Cada tarefa vai para Minhas demandas de quem receber. Com etapa definida, concluir a tarefa avança o post.">
              {tasks.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {tasks.map((t) => (
                    <li key={t.id}>
                      <Link href={`/app/tarefas/${t.id}`} className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px] hover:border-border-strong">
                        {t.who ? <Avatar name={t.who} src={t.whoAvatar} size={18} /> : <span className="size-[18px] shrink-0 rounded-full border border-dashed border-border-strong" aria-hidden />}
                        <span className={cn("min-w-0 flex-1 wrap-anywhere whitespace-normal", t.status === "done" && "text-muted line-through")}>{t.title}</span>
                        <span className="shrink-0 text-[11px] text-muted">{({ pending: "A fazer", blocked: "Aguardando", in_progress: "Fazendo", in_review: "Revisão", done: "Feita", reopened: "Reaberta" } as Record<string, string>)[t.status] ?? t.status}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {canTask && <NewTaskButton clients={[]} members={members.map((m) => ({ id: m.id, name: m.name }))} post={{ id: post.id, clientId: post.clientId, title: post.title, step: post.work }} label="Tarefa" size="sm" variant="secondary" />}
            </Field>

            <Field label="Responsáveis" hint="Quem cuida do post (roteiro, legenda, gestão).">
              <ul className="space-y-1">
                {members.map((m) => {
                  const on = post.assignees.includes(m.id);
                  return (
                    <li key={m.id}>
                      <label className={cn("flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-surface-2 pointer-coarse:py-2 pointer-coarse:text-sm", !canEdit && "cursor-default")}>
                        <input type="checkbox" className="size-3.5 accent-[var(--fg)] pointer-coarse:size-4" checked={on} disabled={!canEdit || pending}
                          onChange={() => run(() => setAssignees(post.id, on ? post.assignees.filter((x) => x !== m.id) : [...post.assignees, m.id]))} />
                        <Avatar name={m.name} src={m.avatar} size={20} />
                        <span className="wrap-anywhere whitespace-normal">{m.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </Field>

            <Field label="Editor" hint="Quem produz a arte ou o vídeo.">
              <Select value={post.editorId ?? ""} disabled={!canEdit || pending} onChange={(e) => run(() => setEditor(post.id, post.clientId, e.target.value || null))}>
                <option value="">Ninguém</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
              {post.editorId && people.get(post.editorId) === undefined && <p className="mt-1 text-xs text-muted">Ex-colaborador</p>}
            </Field>

            <Field label="Publicação">
              <Input type="datetime-local" defaultValue={post.planned} disabled={!canEdit || pending}
                onBlur={(e) => e.target.value !== post.planned && save({ planned_publish_at: e.target.value || null })} />
            </Field>

            <Field label="Formato"><p className="text-[13px]">{post.format}</p></Field>

            {services.length > 0 && (
              <Field label="Subdivisão">
                <Select value={post.serviceId ?? ""} disabled={!canEdit || pending} onChange={(e) => save({ service_id: e.target.value || null })}>
                  <option value="">Nenhuma</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>{children}</section>;
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      {children}
      {hint && <p className="mt-1 text-[11px] text-subtle">{hint}</p>}
    </div>
  );
}
