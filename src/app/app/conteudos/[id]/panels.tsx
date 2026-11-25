"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CalendarCheck, CheckCheck, Copy, Link2, MoreHorizontal, Pencil, ShieldOff, Stamp, Upload, XCircle } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, Menu, MenuItem, useToast } from "@/components/ui/overlay";
import { Panel } from "@/components/ui/primitives";
import { VersionBadge } from "@/components/content/badges";
import { PublicationDialog } from "@/components/content/publication-dialog";
import { Uploader } from "@/components/files/uploader";
import { channels, deliverableKind, textKinds, type ApprovalStatus, type DeliverableKind, type PublicationStatus, type VersionStatus } from "@/lib/domain";
import { toLocalInput } from "@/lib/format";
import { parseMediaLink } from "@/lib/media-link";
import { addComment } from "@/app/app/tarefas/actions";
import { addVersion, archiveContents, cancelContent, duplicateContent, invalidateApproval, setAssignees, unschedulePublication, updateContent } from "../actions";

function useRun() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(r.message ?? "Feito."); after?.(); router.refresh(); } else toast.error(r.error ?? "Erro.");
    });
  return { pending, run };
}

export function ContentActions({ content, can, clientId }: {
  content: { id: string; code: number; title: string; publication: PublicationStatus; approval: ApprovalStatus; planned: string | null; scheduled: string | null; channel: string | null };
  can: { manage: boolean; publish: boolean; approvals: boolean };
  clientId: string;
}) {
  const [pub, setPub] = useState<"schedule" | "confirm" | null>(null);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, run } = useRun();
  const label = `#${content.code} ${content.title}`;
  return (
    <>
      {can.approvals && !["published", "cancelled"].includes(content.publication) && (
        <ButtonLink href={`/app/aprovacoes/novo?cliente=${clientId}&ids=${content.id}`}><Stamp /> Link de aprovação</ButtonLink>
      )}
      {can.publish && ["ready", "planned", "unscheduled"].includes(content.publication) && (
        <Button variant={content.publication === "ready" ? "primary" : "secondary"} onClick={() => setPub("schedule")}><CalendarCheck /> Registrar agendamento</Button>
      )}
      {can.publish && ["scheduled", "ready"].includes(content.publication) && (
        <Button variant={content.publication === "scheduled" ? "primary" : "secondary"} onClick={() => setPub("confirm")}><CheckCheck /> Confirmar publicação</Button>
      )}
      <Menu label="Mais ações" trigger={(p) => <Button size="icon" {...p}><MoreHorizontal /></Button>}>
        {(close) => (
          <>
            {can.manage && <MenuItem onSelect={() => { close(); run(() => duplicateContent(content.id) as never); }}><Copy /> Duplicar</MenuItem>}
            <MenuItem onSelect={() => { close(); navigator.clipboard.writeText(window.location.href); }}><Link2 /> Copiar link interno</MenuItem>
            {can.publish && content.publication === "scheduled" && <MenuItem onSelect={() => { close(); run(() => unschedulePublication(content.id)); }}>Remover agendamento</MenuItem>}
            {can.manage && <MenuItem onSelect={() => { close(); run(() => archiveContents([content.id], true)); }}>Arquivar</MenuItem>}
            {can.manage && content.publication !== "published" && content.publication !== "cancelled" && (
              <MenuItem danger onSelect={() => { close(); setCancel(true); }}><XCircle /> Cancelar conteúdo</MenuItem>
            )}
          </>
        )}
      </Menu>
      <PublicationDialog mode={pub} onClose={() => setPub(null)} content={{ id: content.id, label, approved: content.approval === "approved" }}
        defaults={{ at: content.scheduled ?? content.planned, channel: content.channel }} />
      <Dialog open={cancel} onClose={() => setCancel(false)} size="sm" title="Cancelar conteúdo?" description="Tarefas abertas também são canceladas. O histórico é preservado."
        footer={<><Button onClick={() => setCancel(false)}>Voltar</Button><Button variant="danger" disabled={pending} onClick={() => run(() => cancelContent(content.id, reason), () => setCancel(false))}>Cancelar conteúdo</Button></>}>
        <Textarea aria-label="Motivo" placeholder="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
      </Dialog>
    </>
  );
}

interface DeliverableItem { id: string; kind: DeliverableKind; title: string; approval: VersionStatus; required: boolean; clientFacing: boolean; versions: number; current: number; canUpload: boolean; lastText: string | null }

export function DeliverablesManager({ contentId, workspaceId, clientId, serviceId, deliverables, canInvalidate, bare }: {
  contentId: string; workspaceId: string; clientId: string; serviceId: string | null; deliverables: DeliverableItem[]; canInvalidate: boolean; me: string;
  /** Rendered inside another section: no own frame or title. */
  bare?: boolean;
}) {
  const [open, setOpen] = useState<DeliverableItem | null>(null);
  const [inval, setInval] = useState<DeliverableItem | null>(null);
  const [reason, setReason] = useState("");
  const { pending, run } = useRun();
  // Arriving from a task's "Enviar entrega" (#entrega-video…): unfold this section, scroll to the item and open its upload dialog.
  useEffect(() => {
    const kind = decodeURIComponent(window.location.hash).match(/^#entrega-(.+)$/)?.[1];
    const target = kind ? deliverables.find((d) => d.kind === kind) : undefined;
    if (!target) return;
    const el = document.getElementById(`entrega-${target.kind}`);
    const details = el?.closest("details");
    if (details) details.open = true;
    el?.scrollIntoView({ block: "center" });
    if (!target.canUpload) return;
    const raf = requestAnimationFrame(() => setOpen(target)); // after the section unfolds
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- only on arrival
  return (
    <Panel title={bare ? undefined : "Entregáveis e versões"} padded={false} className={bare ? "rounded-none border-0 bg-transparent" : undefined}>
      <ul className="divide-y divide-border">
        {deliverables.map((d) => (
          <li key={d.id} id={`entrega-${d.kind}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{d.title} {!d.required && <span className="text-xs font-normal text-muted">(opcional)</span>}</p>
              <p className="text-xs text-muted">{deliverableKind[d.kind]} · {d.versions ? `${d.versions} versão(ões), atual V${d.current}` : "nenhuma versão"}{d.clientFacing ? "" : " · interno"}</p>
            </div>
            {d.clientFacing && d.versions > 0 && <VersionBadge s={d.approval} />}
            {canInvalidate && d.approval === "approved" && (
              <Button size="sm" variant="ghost" onClick={() => setInval(d)}><ShieldOff /> Invalidar</Button>
            )}
            {d.canUpload && <Button size="sm" onClick={() => setOpen(d)}><Upload /> {d.versions ? "Nova versão" : "Enviar"}</Button>}
          </li>
        ))}
      </ul>
      {open && <VersionDialog item={open} contentId={contentId} workspaceId={workspaceId} clientId={clientId} serviceId={serviceId} onClose={() => setOpen(null)} />}
      <Dialog open={Boolean(inval)} onClose={() => setInval(null)} title="Invalidar aprovação"
        description="Use quando uma alteração em outro entregável compromete este. O motivo fica registrado e uma tarefa de ajuste é criada."
        footer={<><Button onClick={() => setInval(null)}>Cancelar</Button>
          <Button variant="danger" disabled={pending || reason.trim().length < 3} onClick={() => inval && run(() => invalidateApproval(inval.id, contentId, reason), () => { setInval(null); setReason(""); })}>Invalidar aprovação</Button></>}>
        <Textarea aria-label="Motivo" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: o vídeo foi recortado e a capa ficou desatualizada." />
      </Dialog>
    </Panel>
  );
}

function VersionDialog({ item, contentId, workspaceId, clientId, serviceId, onClose }: {
  item: DeliverableItem; contentId: string; workspaceId: string; clientId: string; serviceId: string | null; onClose: () => void;
}) {
  const isText = textKinds.includes(item.kind);
  const [text, setText] = useState(item.lastText ?? "");
  const [url, setUrl] = useState("");
  const [reason, setReason] = useState("");
  const [assets, setAssets] = useState<string[]>([]);
  const { pending, run } = useRun();
  const needsReason = item.approval === "approved";
  const category = item.kind === "raw_footage" ? "raw" : item.kind === "video" ? "edited_video" : item.kind === "cover" ? "cover" : item.kind === "carousel" ? "carousel" : item.kind === "image" ? "image" : "document";
  const ready = isText ? text.trim().length > 0 : assets.length > 0 || /^https:\/\//.test(url);
  return (
    <Dialog open onClose={onClose} size="lg" title={`${item.versions ? "Nova versão" : "Enviar"}: ${item.title}`}
      description={item.versions ? `Será a V${item.current + 1}. A V${item.current} fica preservada no histórico.` : undefined}
      footer={<><Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" disabled={pending || !ready || (needsReason && reason.trim().length < 3)}
          onClick={() => run(() => addVersion({ deliverable: item.id, content: contentId, text: isText ? text : null, assets, url: url || null, reason: reason || null }), onClose)}>
          Salvar versão</Button></>}>
      <div className="space-y-4">
        {isText ? (
          <label className="block text-[13px] font-medium">{deliverableKind[item.kind]}
            <Textarea className="mt-1.5" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
            <span className="mt-1 block text-right text-xs font-normal text-muted tabular">{text.length} caracteres</span>
          </label>
        ) : (
          <>
            <Uploader workspaceId={workspaceId} clientId={clientId} serviceId={serviceId} category={category as never}
              accept={item.kind === "raw_footage" || item.kind === "video" ? "video" : item.kind === "cover" || item.kind === "image" || item.kind === "carousel" ? "image" : "any"}
              multiple={["carousel", "image", "raw_footage"].includes(item.kind)} onUploaded={(ids) => setAssets((a) => [...new Set([...a, ...ids])])} />
            {["carousel", "image", "raw_footage"].includes(item.kind) && (
              <p className="text-xs text-muted">
                {assets.length > 0 ? `${assets.length} arquivo(s) nesta versão, na ordem de envio. ` : ""}
                Pode enviar vários arquivos: todos entram na mesma versão e o cliente vê e avalia o conjunto.
              </p>
            )}
            <DriveLinkField kind={item.kind} id={item.id} url={url} setUrl={setUrl} />
          </>
        )}
        <label className="block text-[13px] font-medium">Motivo da alteração {needsReason ? <span className="text-[var(--tone-danger-fg)]">(obrigatório: substitui versão aprovada)</span> : <span className="font-normal text-muted">(opcional)</span>}
          <Input className="mt-1.5" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ajuste do CTA, corte do início…" />
        </label>
        {needsReason && <p className="text-xs text-[var(--tone-warning-fg)]">A aprovação atual volta para pendente; o histórico da versão aprovada é preservado.</p>}
      </div>
    </Dialog>
  );
}

export function EditDetails({ content, canEdit, services, members, assignees }: {
  content: { id: string; lock: number; title: string; objective: string | null; briefing: string | null; description: string | null; priority: string;
    due_at: string | null; planned_publish_at: string | null; channel: string | null; service_id: string | null; published_url: string | null };
  canEdit: boolean;
  services: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
  assignees: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({
    title: content.title, objective: content.objective ?? "", briefing: content.briefing ?? "", priority: content.priority,
    due_at: toLocalInput(content.due_at), planned_publish_at: toLocalInput(content.planned_publish_at), channel: content.channel ?? "", service_id: content.service_id ?? "",
  });
  const [team, setTeam] = useState(new Set(assignees));
  const { pending, run } = useRun();
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  return (
    <Panel title="Detalhes" actions={canEdit && !editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil /> Editar</Button>}>
      {!editing ? (
        <div className="space-y-3 text-[13px]">
          <div><p className="text-xs text-muted">Objetivo</p><p>{content.objective || "—"}</p></div>
          <div><p className="text-xs text-muted">Briefing</p><p className="whitespace-pre-wrap">{content.briefing || "—"}</p></div>
          <div><p className="text-xs text-muted">Responsáveis</p><p>{assignees.length ? assignees.map((a) => nameOf.get(a)).filter(Boolean).join(", ") : "Definidos por etapa nas tarefas"}</p></div>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block text-xs font-medium">Título<Input className="mt-1" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></label>
          <label className="block text-xs font-medium">Subdivisão
            <Select className="mt-1" value={v.service_id} onChange={(e) => setV({ ...v, service_id: e.target.value })}><option value="">Sem subdivisão</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          </label>
          <label className="block text-xs font-medium">Objetivo<Input className="mt-1" value={v.objective} onChange={(e) => setV({ ...v, objective: e.target.value })} /></label>
          <label className="block text-xs font-medium">Briefing<Textarea className="mt-1" rows={4} value={v.briefing} onChange={(e) => setV({ ...v, briefing: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-medium">Prazo<Input className="mt-1" type="datetime-local" value={v.due_at} onChange={(e) => setV({ ...v, due_at: e.target.value })} /></label>
            <label className="block text-xs font-medium">Postagem prevista<Input className="mt-1" type="datetime-local" value={v.planned_publish_at} onChange={(e) => setV({ ...v, planned_publish_at: e.target.value })} /></label>
            <label className="block text-xs font-medium">Prioridade
              <Select className="mt-1" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="urgent">Urgente</option></Select>
            </label>
            <label className="block text-xs font-medium">Canal
              <Select className="mt-1" value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })}><option value="">—</option>{Object.entries(channels).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</Select>
            </label>
          </div>
          <fieldset><legend className="mb-1 text-xs font-medium">Responsáveis gerais</legend>
            <div className="max-h-32 space-y-1 overflow-y-auto">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" className="size-4 accent-[var(--fg)]" checked={team.has(m.id)} onChange={(e) => { const n = new Set(team); if (e.target.checked) n.add(m.id); else n.delete(m.id); setTeam(n); }} />{m.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={pending} onClick={() => run(async () => {
              const r = await updateContent(content.id, content.lock, {
                title: v.title, objective: v.objective || null, briefing: v.briefing || null, priority: v.priority as never,
                due_at: v.due_at || null, planned_publish_at: v.planned_publish_at || null, channel: v.channel || null, service_id: v.service_id || null,
              });
              if (!r.ok) return r;
              const changed = team.size !== assignees.length || assignees.some((a) => !team.has(a));
              return changed ? setAssignees(content.id, [...team]) : r;
            }, () => setEditing(false))}>Salvar</Button>
            <Button size="sm" onClick={() => setEditing(false)}>Cancelar</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function CommentBox({ contentId }: { contentId: string }) {
  const [body, setBody] = useState("");
  const { pending, run } = useRun();
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(() => addComment(contentId, body), () => setBody("")); }} className="space-y-2">
      <Textarea aria-label="Novo comentário" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Comentário interno (o cliente não vê)…"
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (body.trim()) run(() => addComment(contentId, body), () => setBody("")); } }} />
      <div className="flex justify-end"><Button type="submit" size="sm" disabled={pending || !body.trim()}>Comentar</Button></div>
    </form>
  );
}

/** Link field for media hosted on Google Drive (keeps large videos off the 50 MB upload limit). */
function DriveLinkField({ kind, id, url, setUrl }: { kind: DeliverableKind; id: string; url: string; setUrl: (v: string) => void }) {
  const isVideo = kind === "video" || kind === "raw_footage";
  const parsed = parseMediaLink(url);
  const note = "mt-1 text-xs";
  return (
    <div className="rounded-md border border-border bg-surface-2/40 p-3">
      <label className="block text-[13px] font-medium" htmlFor={`url-${id}`}>
        {isVideo ? "Ou cole o link do vídeo no Google Drive" : "Ou cole um link do Google Drive"}
        {isVideo && <span className="font-normal text-muted"> · recomendado para vídeos (o envio direto aceita até 50 MB)</span>}
      </label>
      <Input id={`url-${id}`} className="mt-1.5" type="url" placeholder="https://drive.google.com/file/d/…" value={url} onChange={(e) => setUrl(e.target.value)} />
      {url && !parsed && <p className={`${note} text-[var(--tone-danger-fg)]`}>Link inválido: ele precisa começar com https://</p>}
      {parsed?.kind === "drive-folder" && kind !== "raw_footage" && (
        <p className={`${note} text-[var(--tone-warning-fg)]`}>Isto é uma pasta. Para o cliente ver no portal, abra o arquivo no Drive e copie o link dele.</p>
      )}
      {parsed && ["drive", "youtube", "vimeo"].includes(parsed.kind) && <p className={`${note} text-[var(--tone-success-fg)]`}>Link reconhecido: o arquivo vai aparecer direto no portal do cliente.</p>}
      <p className={`${note} text-muted`}>
        No Drive: botão direito no arquivo → <strong className="font-medium text-fg">Compartilhar</strong> → em “Acesso geral”, escolha{" "}
        <strong className="font-medium text-fg">Qualquer pessoa com o link</strong> → Copiar link. Sem isso, o cliente não consegue assistir.
      </p>
    </div>
  );
}
