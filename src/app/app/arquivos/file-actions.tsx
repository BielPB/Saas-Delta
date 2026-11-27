"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Link2, Loader2, MoreHorizontal, Plus, Upload } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Dialog, Menu, MenuItem, useToast } from "@/components/ui/overlay";
import { Uploader } from "@/components/files/uploader";
import { deliverableKind, type DeliverableKind } from "@/lib/domain";
import { requestPreview } from "@/app/app/integracoes/actions";
import { archiveAsset, linkAsset, suggestionsFor, type Suggestion } from "./actions";
import { subdivisionText } from "@/lib/labels";

export function FileActions({ asset, canManage, canCreateContent, onDelete }: {
  asset: { id: string; name: string; provider: string; linked: boolean; clientId: string | null; mime: string | null };
  canManage: boolean; canCreateContent: boolean;
  /** Opens the shared delete confirmation (FileList). */
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sugs, setSugs] = useState<Suggestion[] | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const r = await fn(); if (r.ok) { toast.success(r.message ?? "Feito."); setOpen(false); router.refresh(); } else toast.error(r.error ?? "Erro.");
  });
  return (
    <>
      {!asset.linked && asset.clientId && (
        <Button size="sm" onClick={() => { setOpen(true); setSugs(null); start(async () => setSugs(await suggestionsFor(asset.id))); }}><Link2 /> Vincular</Button>
      )}
      <Menu label="Ações do arquivo" trigger={(p) => <Button size="icon-sm" variant="ghost" {...p}><MoreHorizontal /></Button>}>
        {(close) => (
          <>
            {asset.provider === "drive" && asset.mime?.startsWith("video/") && (
              <MenuItem onSelect={() => { close(); run(() => requestPreview(asset.id)); }}>Gerar preview para o portal</MenuItem>
            )}
            {canManage && onDelete && <MenuItem danger onSelect={() => { close(); onDelete(); }}>Excluir</MenuItem>}
            {canManage && !onDelete && <MenuItem danger onSelect={() => { close(); run(() => archiveAsset(asset.id)); }}>Arquivar referência</MenuItem>}
          </>
        )}
      </Menu>
      <Dialog open={open} onClose={() => setOpen(false)} title="Vincular arquivo" description={asset.name}>
        {sugs === null ? <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted" /></div> : sugs.length === 0 ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted">Nenhum conteúdo compatível encontrado com segurança. Crie um conteúdo e depois vincule o arquivo à entrega certa.</p>
            {canCreateContent && <ButtonLink href={`/app/conteudos/novo?cliente=${asset.clientId}`} variant="primary"><Plus /> Criar conteúdo</ButtonLink>}
          </div>
        ) : (
          <ul className="space-y-2">
            {sugs.map((s) => (
              <li key={s.deliverable_id} className="flex items-center gap-3 rounded-md border border-border p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="wrap-anywhere whitespace-normal text-[13px] font-medium"><span className="font-mono text-xs text-subtle">#{s.code}</span> {s.title}</p>
                  <p className="text-xs text-muted">{deliverableKind[s.deliverable_kind as DeliverableKind]} · {subdivisionText(s.reasons.join(" · "))}</p>
                </div>
                <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => linkAsset(asset.id, s.deliverable_id, s.content_id))}>Confirmar</Button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </>
  );
}

export function LibraryUpload({ workspaceId, clients }: { workspaceId: string; clients: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState("");
  const [category, setCategory] = useState("edited_video");
  const toast = useToast();
  const router = useRouter();
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}><Upload /> Enviar arquivos</Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="lg" title="Enviar para a biblioteca" description="Arquivos enviados aqui ficam disponíveis para vincular a conteúdos.">
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium">Cliente<Select className="mt-1" value={client} onChange={(e) => setClient(e.target.value)}><option value="">Selecione…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>
          <label className="text-xs font-medium">Categoria
            <Select className="mt-1" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="edited_video">Vídeos editados</option><option value="raw">Material bruto</option><option value="cover">Capas</option>
              <option value="image">Imagens</option><option value="carousel">Carrosséis</option><option value="document">Documentos</option><option value="brand">Identidade visual</option>
            </Select>
          </label>
        </div>
        {client ? (
          <Uploader key={client + category} workspaceId={workspaceId} clientId={client} category={category as never} multiple
            onUploaded={(ids) => { toast.success(`${ids.length} arquivo(s) enviado(s).`); router.refresh(); }} />
        ) : <p className="text-sm text-muted">Escolha o cliente para liberar o envio.</p>}
      </Dialog>
    </>
  );
}
