"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, useToast } from "@/components/ui/overlay";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { deleteAssets } from "./actions";
import { FileActions } from "./file-actions";

export interface FileRow {
  id: string; name: string; thumb: string | null; ext: string; meta: string; status: string; linked: boolean;
  provider: string; clientId: string | null; mime: string | null; driveId: string | null; highlight: boolean;
}

export function FileList({ rows, canManage, canCreateContent }: { rows: FileRow[]; canManage: boolean; canCreateContent: boolean }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const target = confirm ? rows.filter((r) => confirm.includes(r.id)) : [];
  const inUse = target.filter((r) => r.linked).length;
  const free = target.length - inUse;
  const fromDrive = target.filter((r) => r.provider === "drive").length;

  const doDelete = () => start(async () => {
    const r = await deleteAssets(confirm ?? []);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(r.message ?? "Arquivos excluídos.");
    setSel(new Set()); setConfirm(null); router.refresh();
  });

  return (
    <section className="rounded-lg border border-border bg-surface">
      {canManage && (
        <div className={cn("flex items-center gap-3 border-b border-border px-4 py-2", sel.size > 0 && "bg-surface-2")}>
          <input type="checkbox" className="size-4 accent-[var(--fg)]" checked={all} aria-label="Selecionar todos"
            onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} />
          <span className="text-xs text-muted">{sel.size > 0 ? `${sel.size} selecionado(s)` : "Selecionar todos"}</span>
          {sel.size > 0 && (
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Limpar</Button>
              <Button size="sm" variant="danger" onClick={() => setConfirm([...sel])}><Trash2 /> Excluir ({sel.size})</Button>
            </div>
          )}
        </div>
      )}
      <ul className="divide-y divide-border">
        {rows.map((f) => (
          <li key={f.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-2.5", f.highlight && "bg-accent-soft", sel.has(f.id) && "bg-surface-2/60")}>
            {canManage && <input type="checkbox" className="size-4 shrink-0 accent-[var(--fg)]" checked={sel.has(f.id)} onChange={() => toggle(f.id)} aria-label={`Selecionar ${f.name}`} />}
            <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-surface-2 text-[10px] uppercase text-subtle">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
              {f.thumb ? <img src={f.thumb} alt="" className="size-full object-cover" loading="lazy" /> : f.ext}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium" title={f.name}>{f.name}</p>
              <p className="truncate text-xs text-muted">{f.meta}</p>
            </div>
            {f.status === "missing" && <Badge tone="danger">Não encontrado na origem</Badge>}
            {f.status === "processing" && <Badge tone="info">Gerando preview</Badge>}
            {f.linked ? <Badge tone="success">Em uso</Badge> : <Badge>Sem vínculo</Badge>}
            {f.driveId && <a className="text-xs text-muted underline-offset-2 hover:underline" target="_blank" rel="noreferrer noopener" href={`https://drive.google.com/file/d/${encodeURIComponent(f.driveId)}/view`}>Abrir no Drive</a>}
            <FileActions asset={{ id: f.id, name: f.name, provider: f.provider, linked: f.linked, clientId: f.clientId, mime: f.mime }}
              canManage={canManage} canCreateContent={canCreateContent} onDelete={() => setConfirm([f.id])} />
          </li>
        ))}
      </ul>

      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} size="sm"
        title={target.length === 1 ? `Excluir “${target[0]?.name}”?` : `Excluir ${target.length} arquivos?`}
        footer={<><Button onClick={() => setConfirm(null)}>Cancelar</Button>
          <Button variant="danger" disabled={pending} onClick={doDelete}>{pending ? <Loader2 className="animate-spin" /> : <Trash2 />} Excluir</Button></>}>
        <ul className="space-y-2 text-sm">
          {free > 0 && <li><strong>{free}</strong> {free === 1 ? "arquivo sem vínculo será excluído" : "arquivos sem vínculo serão excluídos"} de vez. Não dá para desfazer.</li>}
          {inUse > 0 && (
            <li><strong>{inUse}</strong> {inUse === 1 ? "está em uso" : "estão em uso"} em versões de conteúdo. {inUse === 1 ? "Ele sai" : "Eles saem"} da aba Arquivos, mas {inUse === 1 ? "continua" : "continuam"} no histórico do conteúdo, porque o cliente pode ter aprovado essa versão.</li>
          )}
          {fromDrive > 0 && <li className="text-muted">Arquivos do Google Drive continuam no Drive: só a referência no Delta Flow é removida.</li>}
        </ul>
      </Dialog>
    </section>
  );
}
