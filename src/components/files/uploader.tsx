"use client";
import { useCallback, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { FileUp, Loader2, Pause, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBrowserClient } from "@/lib/supabase/browser";
import { bytes } from "@/lib/format";
import { storagePath, cn } from "@/lib/utils";
import { findDuplicate, registerAsset } from "@/app/app/conteudos/actions";

export const MAX_UPLOAD_BYTES = 5 * 1024 ** 3; // mirrors the bucket file_size_limit
const ACCEPT: Record<string, string> = {
  video: "video/mp4,video/quicktime,video/webm,video/x-matroska",
  image: "image/jpeg,image/png,image/webp,image/heic,image/gif",
  any: "video/mp4,video/quicktime,video/webm,video/x-matroska,image/jpeg,image/png,image/webp,image/heic,image/gif,application/pdf,text/plain,application/zip",
};

type Category = "raw" | "edited_video" | "cover" | "image" | "carousel" | "script" | "document" | "approved" | "brand";
interface Item {
  key: string; file: File; progress: number; status: "checking" | "duplicate" | "uploading" | "paused" | "done" | "error";
  error?: string; upload?: tus.Upload; assetId?: string; duplicateOf?: { id: string; name: string };
}

async function probe(file: File): Promise<{ width?: number; height?: number; duration?: number }> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("video/")) {
      return await new Promise((res) => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = () => res({ width: v.videoWidth || undefined, height: v.videoHeight || undefined, duration: Number.isFinite(v.duration) ? v.duration : undefined });
        v.onerror = () => res({});
        v.src = url;
      });
    }
    if (file.type.startsWith("image/")) {
      return await new Promise((res) => {
        const i = new Image();
        i.onload = () => res({ width: i.naturalWidth, height: i.naturalHeight });
        i.onerror = () => res({});
        i.src = url;
      });
    }
    return {};
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Resumable upload (TUS) straight to Supabase Storage with the user's JWT.
 * Interrupted uploads resume from the last 6 MB chunk (tus fingerprint).
 */
export function Uploader({ workspaceId, clientId, serviceId, category, accept = "any", multiple, onUploaded, compact }: {
  workspaceId: string;
  clientId: string | null;
  serviceId?: string | null;
  category: Category;
  accept?: "video" | "image" | "any";
  multiple?: boolean;
  onUploaded: (assetIds: string[]) => void;
  compact?: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef<string[]>([]);
  const patch = (key: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const finishIfAll = useCallback((list: Item[]) => {
    if (list.length && list.every((x) => x.status === "done" || x.status === "error")) {
      const ids = list.filter((x) => x.assetId).map((x) => x.assetId!);
      if (ids.length) onUploaded(ids);
    }
  }, [onUploaded]);

  const start = useCallback(async (item: Item) => {
    const sb = getBrowserClient();
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) { patch(item.key, { status: "error", error: "Sessão expirada. Entre novamente." }); return; }
    const meta = await probe(item.file);
    const objectName = storagePath(workspaceId, clientId, crypto.randomUUID(), item.file.name);
    const upload = new tus.Upload(item.file, {
      endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 2000, 5000, 10000, 20000, 30000],
      headers: { authorization: `Bearer ${token}`, "x-upsert": "false" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024, // Supabase requires exactly 6 MB chunks
      metadata: { bucketName: "workspace-files", objectName, contentType: item.file.type || "application/octet-stream", cacheControl: "3600" },
      onProgress: (sent, total) => patch(item.key, { progress: Math.round((sent / total) * 100), status: "uploading" }),
      onError: (err) => {
        const msg = /413|too large/i.test(String(err)) ? "Arquivo maior que o limite do armazenamento." :
          /403|row-level/i.test(String(err)) ? "Sem permissão para enviar para este cliente." : "Falha no envio. Use “Retomar” para continuar de onde parou.";
        patch(item.key, { status: "error", error: msg });
      },
      onSuccess: async () => {
        const r = await registerAsset({
          path: objectName, name: item.file.name, mime: item.file.type || "application/octet-stream", size: item.file.size,
          client_id: clientId, service_id: serviceId ?? null, category,
          width: meta.width ?? null, height: meta.height ?? null, duration: meta.duration ?? null,
        });
        if (r.ok && r.data) {
          done.current.push(r.data.id);
          setItems((xs) => { const next = xs.map((x) => (x.key === item.key ? { ...x, status: "done" as const, progress: 100, assetId: r.data!.id } : x)); finishIfAll(next); return next; });
        } else patch(item.key, { status: "error", error: r.ok ? "Erro ao registrar arquivo." : r.error });
      },
    });
    const previous = await upload.findPreviousUploads();
    if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
    patch(item.key, { upload, status: "uploading" });
    upload.start();
  }, [workspaceId, clientId, serviceId, category, finishIfAll]);

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, multiple ? 30 : 1);
    const allowed = ACCEPT[accept].split(",");
    for (const file of list) {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (!allowed.includes(file.type)) {
        setItems((xs) => [...xs, { key, file, progress: 0, status: "error", error: "Formato não aceito." }]);
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setItems((xs) => [...xs, { key, file, progress: 0, status: "error", error: `Máximo de ${bytes(MAX_UPLOAD_BYTES)}.` }]);
        continue;
      }
      const item: Item = { key, file, progress: 0, status: "checking" };
      setItems((xs) => [...xs.filter((x) => x.key !== key), item]);
      const dup = await findDuplicate(clientId, file.name, file.size);
      if (dup) patch(key, { status: "duplicate", duplicateOf: dup });
      else void start(item);
    }
  };

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files); }}
        className={cn("flex flex-col items-center justify-center rounded-md border border-dashed border-border-strong bg-surface-2/50 text-center transition-colors",
          compact ? "px-3 py-4" : "px-4 py-8", drag && "border-fg bg-accent-soft")}
      >
        <FileUp className="mb-2 size-5 text-muted" aria-hidden />
        <p className="text-sm">Arraste {multiple ? "arquivos" : "o arquivo"} aqui ou{" "}
          <button type="button" className="font-medium underline underline-offset-4" onClick={() => input.current?.click()}>selecione</button>
        </p>
        <p className="mt-1 text-xs text-muted">Até {bytes(MAX_UPLOAD_BYTES)} por arquivo. Envio retomável se a conexão cair.</p>
        <input ref={input} type="file" hidden accept={ACCEPT[accept]} multiple={multiple} onChange={(e) => e.target.files && addFiles(e.target.files)} />
      </div>
      {items.length > 0 && (
        <ul className="space-y-1.5" aria-live="polite">
          {items.map((it) => (
            <li key={it.key} className="rounded-md border border-border px-3 py-2">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate" title={it.file.name}>{it.file.name}</span>
                <span className="tabular shrink-0 text-xs text-muted">{bytes(it.file.size)}</span>
                {it.status === "uploading" && <Button size="icon-sm" variant="ghost" aria-label="Pausar" onClick={() => { it.upload?.abort(); patch(it.key, { status: "paused" }); }}><Pause /></Button>}
                {(it.status === "paused" || (it.status === "error" && it.upload)) && <Button size="icon-sm" variant="ghost" aria-label="Retomar" onClick={() => { it.upload?.start(); patch(it.key, { status: "uploading", error: undefined }); }}><Play /></Button>}
                {it.status !== "done" && <Button size="icon-sm" variant="ghost" aria-label="Cancelar envio" onClick={() => { it.upload?.abort(true); setItems((xs) => xs.filter((x) => x.key !== it.key)); }}><X /></Button>}
              </div>
              {(it.status === "uploading" || it.status === "paused" || it.status === "done") && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={it.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Envio de ${it.file.name}`}>
                  <div className={cn("h-full transition-[width]", it.status === "done" ? "bg-accent" : "bg-fg/70")} style={{ width: `${it.progress}%` }} />
                </div>
              )}
              {it.status === "checking" && <p className="mt-1 flex items-center gap-1 text-xs text-muted"><Loader2 className="size-3 animate-spin" /> Verificando duplicidade…</p>}
              {it.status === "duplicate" && it.duplicateOf && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-[var(--tone-warning-fg)]">Já existe um arquivo idêntico (mesmo nome e tamanho).</span>
                  <Button size="sm" onClick={() => { patch(it.key, { status: "done", progress: 100, assetId: it.duplicateOf!.id }); onUploaded([it.duplicateOf!.id]); }}>Usar existente</Button>
                  <Button size="sm" variant="ghost" onClick={() => void start(it)}>Enviar mesmo assim</Button>
                </div>
              )}
              {it.status === "paused" && <p className="mt-1 text-xs text-muted">Pausado em {it.progress}%.</p>}
              {it.error && <p className="mt-1 text-xs text-[var(--tone-danger-fg)]">{it.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
