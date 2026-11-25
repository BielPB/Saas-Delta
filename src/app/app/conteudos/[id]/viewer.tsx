"use client";
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, ExternalLink, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";
import { deliverableKind, versionStatus, type DeliverableKind, type VersionStatus } from "@/lib/domain";
import { relative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LinkEmbed } from "@/components/content/link-embed";

export interface ViewerAsset {
  id: string; name: string; mime: string | null; provider: string; status: string; width: number | null; height: number | null;
  url: string | null; poster: string | null; driveId: string | null; externalUrl: string | null;
}
export interface ViewerVersion {
  id: string; number: number; status: VersionStatus; text: string | null; url: string | null; reason: string | null;
  createdAt: string; released: boolean; author: string | null; assets: ViewerAsset[];
  decisions: Array<{ decision: string; comment: string | null; reviewer_name: string | null; created_at: string }>;
}
export interface ViewerDeliverable {
  id: string; kind: DeliverableKind; title: string; clientFacing: boolean; approval: VersionStatus; currentVersionId: string | null; versions: ViewerVersion[];
}

const ratioOf = (a: string) => (a === "16:9" ? "16 / 9" : a === "1:1" ? "1 / 1" : a === "4:5" ? "4 / 5" : "9 / 16");

/** Media stage: keeps the original proportion (object-contain), never crops or stretches. */
function Stage({ asset, aspect }: { asset: ViewerAsset; aspect: string }) {
  const box = useRef<HTMLDivElement>(null);
  const ratio = asset.width && asset.height ? `${asset.width} / ${asset.height}` : ratioOf(aspect);
  const fullscreen = () => box.current?.requestFullscreen?.();
  if (asset.provider === "drive" || !asset.url) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-md bg-surface-2 p-6 text-center">
        <p className="text-sm font-medium">{asset.name}</p>
        <p className="max-w-sm text-xs text-muted">
          {asset.provider === "drive" ? "Arquivo referenciado do Google Drive. A reprodução no portal do cliente usa uma cópia privada gerada a partir dele." :
            asset.status === "missing" ? "Arquivo não encontrado na origem." : "Pré-visualização indisponível."}
        </p>
        {asset.driveId && (
          <a className="inline-flex items-center gap-1 text-[13px] font-medium underline underline-offset-4" target="_blank" rel="noreferrer noopener"
            href={`https://drive.google.com/file/d/${encodeURIComponent(asset.driveId)}/view`}>Abrir no Drive <ExternalLink className="size-3.5" /></a>
        )}
      </div>
    );
  }
  return (
    <div ref={box} className="group relative mx-auto flex max-h-[70vh] w-full items-center justify-center overflow-hidden rounded-md bg-black"
      style={{ aspectRatio: ratio, maxWidth: `calc(70vh * (${ratio}))` }}>
      {asset.mime?.startsWith("video/") ? (
        <video key={asset.url} src={asset.url} poster={asset.poster ?? undefined} controls playsInline preload="metadata" className="size-full object-contain">
          <track kind="captions" />
        </video>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- signed private URL, must not enter a shared optimizer cache
        <img src={asset.url} alt={asset.name} className="size-full object-contain" />
      )}
      <Button size="icon-sm" variant="secondary" className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" onClick={fullscreen} aria-label="Tela cheia"><Maximize2 /></Button>
    </div>
  );
}

export function ContentViewer({ deliverables, aspect }: { deliverables: ViewerDeliverable[]; aspect: string }) {
  const visual = deliverables.filter((d) => d.kind !== "caption");
  const caption = deliverables.find((d) => d.kind === "caption");
  const [sel, setSel] = useState(visual[0]?.id ?? caption?.id ?? "");
  const d = deliverables.find((x) => x.id === sel);
  const [versionId, setVersionId] = useState<string | null>(d?.versions[0]?.id ?? null);
  const [slide, setSlide] = useState(0);
  const toast = useToast();
  const select = (id: string) => { setSel(id); setVersionId(deliverables.find((x) => x.id === id)?.versions[0]?.id ?? null); setSlide(0); };
  const v = d?.versions.find((x) => x.id === versionId) ?? d?.versions[0];
  const capV = caption?.versions[0];

  if (deliverables.length === 0) return <div className="rounded-lg border border-border bg-surface"><EmptyState title="Sem entregáveis" /></div>;

  return (
    <section className="rounded-lg border border-border bg-surface" aria-label="Visualizador de conteúdo">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
        {deliverables.map((x) => (
          <button key={x.id} type="button" onClick={() => select(x.id)} aria-pressed={sel === x.id}
            className={cn("flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted hover:bg-surface-2", sel === x.id && "bg-surface-2 font-medium text-fg")}>
            {x.title}
            {x.versions.length > 0 && <span className="tabular text-[11px] text-subtle">V{x.versions[0].number}</span>}
            <span className="size-1.5 rounded-full" style={{ background: `var(--tone-${versionStatus[x.approval].tone}-fg)` }} aria-label={versionStatus[x.approval].label} />
          </button>
        ))}
        <div className="flex-1" />
        {d && d.versions.length > 1 && (
          <label className="flex items-center gap-1.5 text-xs text-muted">Versão
            <select className="h-7 rounded-sm border border-border bg-surface px-1.5 text-xs text-fg" value={v?.id} onChange={(e) => { setVersionId(e.target.value); setSlide(0); }}>
              {d.versions.map((x) => <option key={x.id} value={x.id}>V{x.number} · {versionStatus[x.status].label}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="p-3 sm:p-4">
        {!d || !v ? (
          <EmptyState compact title={`${d ? deliverableKind[d.kind] : "Entregável"} ainda não enviado`} description="A versão aparece aqui assim que o responsável enviar o arquivo ou texto." />
        ) : d.kind === "caption" || (v.text && v.assets.length === 0) ? (
          <div className="mx-auto max-w-2xl">
            <p className="whitespace-pre-wrap rounded-md border border-border bg-surface-2/50 p-4 text-[14px] leading-relaxed">{v.text}</p>
            <Button size="sm" className="mt-2" onClick={() => navigator.clipboard.writeText(v.text ?? "").then(() => toast.success("Legenda copiada."))}><Copy /> Copiar texto</Button>
          </div>
        ) : v.assets.length > 1 ? (
          <div>
            <Stage asset={v.assets[slide]} aspect={aspect} />
            <div className="mt-2 flex items-center justify-center gap-2">
              <Button size="icon-sm" onClick={() => setSlide((s) => Math.max(0, s - 1))} disabled={slide === 0} aria-label="Slide anterior"><ChevronLeft /></Button>
              <span className="tabular text-xs text-muted" aria-live="polite">Slide {slide + 1} de {v.assets.length}</span>
              <Button size="icon-sm" onClick={() => setSlide((s) => Math.min(v.assets.length - 1, s + 1))} disabled={slide === v.assets.length - 1} aria-label="Próximo slide"><ChevronRight /></Button>
            </div>
            <ul className="mt-2 flex justify-center gap-1.5 overflow-x-auto">
              {v.assets.map((a, i) => (
                <li key={a.id}>
                  <button type="button" onClick={() => setSlide(i)} aria-label={`Slide ${i + 1}`} aria-current={i === slide}
                    className={cn("block w-12 overflow-hidden rounded-sm border-2 border-transparent", i === slide && "border-fg")} style={{ aspectRatio: ratioOf(aspect) }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
                    {a.url ? <img src={a.url} alt="" className="size-full object-cover" /> : <span className="block size-full bg-surface-2" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : v.assets[0] ? (
          <Stage asset={v.assets[0]} aspect={aspect} />
        ) : v.url ? (
          <LinkEmbed url={v.url} aspect={d.kind === "cover" ? "4:5" : aspect} />
        ) : null}

        {v && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-muted">
            <Badge tone={versionStatus[v.status].tone}>V{v.number} · {versionStatus[v.status].label}</Badge>
            {!v.released && d?.clientFacing && <Badge>Aguardando revisão interna</Badge>}
            <span>{v.author ?? "—"} · {relative(v.createdAt)}</span>
            {v.reason && <span>Motivo: {v.reason}</span>}
            {v.decisions.map((x, i) => (
              <span key={i} className={x.decision === "rejected" ? "text-[var(--tone-danger-fg)]" : "text-[var(--tone-success-fg)]"}>
                {x.reviewer_name ?? "Cliente"} {x.decision === "rejected" ? "reprovou" : "aprovou"} {relative(x.created_at)}{x.comment ? `: “${x.comment}”` : ""}
              </span>
            ))}
          </div>
        )}
      </div>

      {caption && d?.kind !== "caption" && (
        <div className="border-t border-border p-3 sm:p-4">
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-xs font-semibold">Legenda {capV ? `V${capV.number}` : ""}</h3>
            {capV?.text && <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(capV.text ?? "").then(() => toast.success("Legenda copiada."))}><Copy /> Copiar</Button>}
          </div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted">{capV?.text ?? "Legenda ainda não enviada."}</p>
        </div>
      )}
    </section>
  );
}
