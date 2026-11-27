"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Film, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, useToast } from "@/components/ui/overlay";
import { linkThumbnail } from "@/lib/media-link";
import { createPostsFromLinks, scanVideoLinks } from "./bulk-actions";

type Row = { url: string; title: string; serviceId: string };

const titleFrom = (name: string) => name.replace(/\.[A-Za-z0-9]{2,5}$/, "").replace(/[_]+/g, " ").trim().slice(0, 200);

/**
 * "Vários vídeos por link": paste one Drive folder link (or several video links), pick the
 * subdivision of each video and create one post per video with its link already attached.
 */
export function BulkVideoDialog({ clientId, formats, services, defaultDate, onClose }: {
  clientId: string; formats: Array<{ id: string; name: string }>; services: Array<{ id: string; name: string }>;
  defaultDate: string; onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [format, setFormat] = useState(formats[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const scan = () => start(async () => {
    const r = await scanVideoLinks(clientId, text);
    if (!r.ok) { toast.error(r.error); return; }
    setRows(r.data!.videos.map((v) => ({ url: v.url, title: titleFrom(v.name), serviceId: "" })));
    setNote(r.data!.note);
  });

  const create = () => start(async () => {
    if (!rows?.length) return;
    const r = await createPostsFromLinks({
      clientId, formatId: format, plannedAt: date || null,
      items: rows.map((x) => ({ url: x.url, title: x.title, serviceId: x.serviceId || null })),
    });
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(r.message ?? "Posts criados.");
    onClose();
    router.refresh();
  });

  const setRow = (i: number, patch: Partial<Row>) => setRows((list) => list && list.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  if (!rows) {
    return (
      <Dialog open onClose={onClose} size="md" title="Vários vídeos por link"
        description="Cole o link da pasta do Google Drive com os vídeos. Cada vídeo vira um post, já com o vídeo anexado."
        footer={<>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={pending || !text.trim()} onClick={scan}>{pending && <Loader2 className="animate-spin" />}Buscar vídeos</Button>
        </>}>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) scan(); }}>
          <label className="block text-[13px] font-medium" htmlFor="bulk-links">Link da pasta (ou links dos vídeos, um por linha)</label>
          <Textarea id="bulk-links" autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/…" />
          <p className="text-xs text-muted">
            No Drive: botão direito na pasta → <strong className="font-medium text-fg">Compartilhar</strong> → em “Acesso geral”, escolha{" "}
            <strong className="font-medium text-fg">Qualquer pessoa com o link</strong> → Copiar link. Assim o cliente também consegue assistir no portal.
          </p>
        </form>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} size="lg" title={`${rows.length} vídeo${rows.length === 1 ? "" : "s"} encontrado${rows.length === 1 ? "" : "s"}`}
      description="Escolha a subdivisão de cada vídeo e clique em Subir. O resto você completa no post, como sempre."
      footer={<>
        <Button onClick={() => { setRows(null); setNote(null); }} disabled={pending}>Voltar</Button>
        <Button variant="primary" disabled={pending || !rows.length || !format} onClick={create}>
          {pending && <Loader2 className="animate-spin" />}Subir {rows.length} vídeo{rows.length === 1 ? "" : "s"}
        </Button>
      </>}>
      <div className="space-y-3">
        {note && <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">{note}</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          {formats.length > 1 && (
            <label className="block text-[13px] font-medium">Formato
              <Select className="mt-1" value={format} onChange={(e) => setFormat(e.target.value)}>
                {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            </label>
          )}
          <label className="block text-[13px] font-medium">Publicação
            <Input className="mt-1" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {services.length > 0 && (
            <label className="block text-[13px] font-medium">Subdivisão de todos
              <Select className="mt-1" value="" onChange={(e) => { const v = e.target.value; if (v) setRows((list) => list && list.map((x) => ({ ...x, serviceId: v === "_none" ? "" : v }))); }}>
                <option value="">Aplicar a todos…</option>
                <option value="_none">Nenhuma</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </label>
          )}
        </div>

        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((row, i) => (
            <li key={row.url} className="flex items-center gap-3 p-2">
              <Thumb url={row.url} />
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_12rem]">
                <Input aria-label={`Título do vídeo ${i + 1}`} value={row.title} onChange={(e) => setRow(i, { title: e.target.value })} placeholder={`Vídeo ${i + 1}`} />
                {services.length > 0 && (
                  <Select aria-label={`Subdivisão do vídeo ${i + 1}`} value={row.serviceId} onChange={(e) => setRow(i, { serviceId: e.target.value })}>
                    <option value="">Sem subdivisão</option>
                    {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                )}
              </div>
              <Button variant="ghost" size="icon-sm" aria-label={`Tirar o vídeo ${i + 1}`} onClick={() => setRows((list) => list && list.filter((_, j) => j !== i))}><X /></Button>
            </li>
          ))}
        </ul>
        {services.length === 0 && <p className="text-xs text-muted">Este cliente ainda não tem subdivisões. Os posts serão criados sem subdivisão.</p>}
      </div>
    </Dialog>
  );
}

/** Drive/YouTube still frame; a file not shared publicly has none, so it falls back to an icon. */
function Thumb({ url }: { url: string }) {
  const src = linkThumbnail(url);
  const [broken, setBroken] = useState(false);
  return (
    <span className="flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-2 text-subtle">
      {src && !broken
        // eslint-disable-next-line @next/next/no-img-element -- Drive/YouTube thumbnail
        ? <img src={src} alt="" className="size-full object-cover" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : <Film className="size-4" aria-hidden />}
    </span>
  );
}
