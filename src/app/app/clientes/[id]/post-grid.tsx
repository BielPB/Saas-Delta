"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ImageIcon, Link2, MessageSquare, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Dialog, useToast } from "@/components/ui/overlay";
import { Avatar } from "@/components/ui/primitives";
import { postStatusMeta, type PostStatusKey } from "@/lib/post-status";
import { cn } from "@/lib/utils";
import { createPost } from "./post-actions";
import { BulkVideoDialog } from "./bulk-video-dialog";
import { VideoApprovalButton } from "./video-approval";

/** Formats whose main file is a video: they can be created in bulk from a Drive folder link. */
const VIDEO_FORMATS = new Set(["reels", "stories", "institutional", "ad", "paid_creative", "youtube"]);

export interface GridPost {
  id: string; number: number; title: string; format: string; formatKey: string; status: PostStatusKey;
  thumb: string | null; link: boolean; video?: string | null; people: Array<{ name: string; avatar: string | null }>; comments: number; date: string | null;
}

const toneCls: Record<string, string> = {
  neutral: "bg-surface-3 text-muted", info: "bg-[var(--tone-info-bg)] text-[var(--tone-info-fg)]",
  progress: "bg-[var(--tone-progress-bg)] text-[var(--tone-progress-fg)]", warning: "bg-[var(--tone-warning-bg)] text-[var(--tone-warning-fg)]",
  danger: "bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]", success: "bg-[var(--tone-success-bg)] text-[var(--tone-success-fg)]",
  accent: "bg-accent text-accent-fg",
};
export function StatusPill({ s, className }: { s: PostStatusKey; className?: string }) {
  const m = postStatusMeta[s];
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", toneCls[m.tone], className)}>{m.label}</span>;
}

export function PostGrid({ posts, hrefFor, baseHref, label, clientId, formats, services, canCreate, defaultDate, video }: {
  posts: GridPost[]; hrefFor: Record<string, string>; baseHref: string; label: string; clientId: string;
  formats: Array<{ id: string; name: string; key: string }>; services: Array<{ id: string; name: string }>;
  canCreate: boolean; defaultDate: string;
  /** "Link dos vídeos" (needs approvals.manage). */
  video?: { canSend: boolean; clientName: string; ym: string };
}) {
  const [filter, setFilter] = useState<string>("all");
  const [creating, setCreating] = useState(false);
  const [bulk, setBulk] = useState(false);
  const videoFormats = formats.filter((f) => VIDEO_FORMATS.has(f.key));
  const present = formats.filter((f) => posts.some((p) => p.formatKey === f.key));
  const shown = filter === "all" ? posts : posts.filter((p) => p.formatKey === filter);
  const openVideos = posts.filter((p) => VIDEO_FORMATS.has(p.formatKey) && !["ready", "scheduled", "published", "cancelled"].includes(p.status)).map((p) => p.id);
  const canSendVideos = Boolean(video?.canSend) && openVideos.length > 0;

  return (
    <section aria-label={label}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {present.length > 1 && [{ key: "all", name: "Todos" }, ...present].map((f) => {
            const n = f.key === "all" ? posts.length : posts.filter((p) => p.formatKey === f.key).length;
            return (
              <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors pointer-coarse:py-1.5",
                  filter === f.key ? "border-accent bg-accent text-accent-fg" : "border-border text-muted hover:text-fg")}>
                {f.name} <span className="tabular opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        {(canCreate || canSendVideos) && (
          <div className="flex flex-wrap items-center gap-2">
            {canSendVideos && <VideoApprovalButton clientId={clientId} clientName={video!.clientName} ym={video!.ym} contentIds={openVideos} />}
            {canCreate && videoFormats.length > 0 && <Button size="sm" onClick={() => setBulk(true)}><Link2 /> Vários vídeos por link</Button>}
            {canCreate && <Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus /> Novo {label === "Stories" ? "story" : label === "Reels" ? "reels" : "post"}</Button>}
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <div key={filter} className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-14 text-center">
          <ImageIcon className="size-6 text-subtle" aria-hidden />
          <p className="text-sm font-medium">Nada planejado neste mês</p>
          <p className="max-w-xs text-xs text-muted">Crie o primeiro e acompanhe aqui do planejamento até a publicação.</p>
          {canCreate && <Button size="sm" className="mt-1" onClick={() => setCreating(true)}><Plus /> Criar</Button>}
        </div>
      ) : (
        <ul key={filter} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {shown.map((p) => (
            <li key={p.id}>
              <Link href={hrefFor[p.id]} scroll={false}
                className="group block overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-border-strong">
                <div className="relative aspect-[4/5] bg-surface-2">
                  <MediaPreview thumb={p.thumb} video={p.video ?? null} link={p.link} isVideo={!["static_post", "carousel"].includes(p.formatKey)} />
                  <span className="tabular absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-bold text-white">{String(p.number).padStart(2, "0")}</span>
                  {p.comments > 0 && (
                    <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
                      <MessageSquare className="size-3" aria-hidden />{p.comments}
                    </span>
                  )}
                </div>
                <div className="space-y-2 p-2.5 sm:p-3">
                  <p className="wrap-anywhere whitespace-normal min-h-[2.5em] break-words text-[13px] font-semibold leading-tight">{p.title}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">{p.format}</span>
                    <StatusPill s={p.status} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex -space-x-1.5">
                      {p.people.slice(0, 3).map((a, i) => <Avatar key={i} name={a.name} src={a.avatar} size={22} className="ring-2 ring-surface" />)}
                      {p.people.length === 0 && <span className="text-[11px] text-subtle">Sem responsável</span>}
                    </span>
                    {p.date && <span className="tabular text-[11px] text-subtle">{p.date}</span>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {bulk && <BulkVideoDialog clientId={clientId} formats={videoFormats} services={services} defaultDate={defaultDate} onClose={() => setBulk(false)} />}
      {creating && <NewPostDialog clientId={clientId} formats={formats} services={services} defaultDate={defaultDate} onClose={() => setCreating(false)} hrefBase={baseHref} />}
    </section>
  );
}

function NewPostDialog({ clientId, formats, services, defaultDate, onClose, hrefBase }: {
  clientId: string; formats: Array<{ id: string; name: string; key: string }>; services: Array<{ id: string; name: string }>;
  defaultDate: string; onClose: () => void; hrefBase: string;
}) {
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState(formats[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate);
  const [service, setService] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const submit = () => start(async () => {
    const r = await createPost({ clientId, formatId: format, title, plannedAt: date || null, serviceId: service || null });
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(r.message ?? "Criado.");
    onClose();
    router.push(`${hrefBase}${hrefBase.includes("?") ? "&" : "?"}post=${r.data!.id}`, { scroll: false });
  });
  return (
    <Dialog open onClose={onClose} size="sm" title="Novo post" description="Só o essencial. O resto você completa no post."
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={pending || !title.trim() || !format} onClick={submit}>Criar post</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="block text-[13px] font-medium">Título
          <Input className="mt-1" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: 5 mitos sobre o laser" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[13px] font-medium">Formato
            <Select className="mt-1" value={format} onChange={(e) => setFormat(e.target.value)}>
              {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </label>
          <label className="block text-[13px] font-medium">Publicação
            <Input className="mt-1" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        {services.length > 0 && (
          <label className="block text-[13px] font-medium">Subdivisão
            <Select className="mt-1" value={service} onChange={(e) => setService(e.target.value)}>
              <option value="">Nenhuma</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </label>
        )}
      </form>
    </Dialog>
  );
}

/**
 * Card preview: the art / cover, the Drive or YouTube thumbnail of a linked video, or the first
 * frame of an uploaded video. A Drive file that is not shared publicly has no thumbnail: then the
 * placeholder underneath shows through.
 */
export function MediaPreview({ thumb, video, link, isVideo: videoFormat, className }: {
  thumb: string | null; video: string | null; link: boolean;
  /** Format decides it (Reels/Stories = video, Post/Carrossel = image); falls back to the media type. */
  isVideo?: boolean; className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const isVideo = videoFormat ?? (Boolean(video) || link);
  const showImage = Boolean(thumb) && !broken;
  const showVideo = !thumb && Boolean(video);
  return (
    <span className={cn("absolute inset-0 block bg-surface-2", className)}>
      {!showImage && !showVideo && (
        <span className="flex size-full flex-col items-center justify-center gap-1.5 text-subtle">
          {isVideo ? <Play className="size-7" aria-hidden /> : <ImageIcon className="size-7" aria-hidden />}
          <span className="px-2 text-center text-[11px]">
            {link ? `${isVideo ? "Vídeo" : "Arte"} no Drive${broken ? " (sem prévia: compartilhe o arquivo)" : ""}` : "Sem mídia ainda"}
          </span>
        </span>
      )}
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element -- signed private URL or Drive/YouTube thumbnail
        <img src={thumb!} alt="" onError={() => setBroken(true)} referrerPolicy="no-referrer" loading="lazy"
          className={cn("absolute inset-0 size-full transition-transform duration-300 group-hover:scale-[1.02]",
            isVideo ? "object-cover" : "object-contain p-1")} />
      )}
      {showVideo && (
        <video src={`${video}#t=0.5`} muted playsInline preload="metadata" aria-hidden className="absolute inset-0 size-full object-cover" />
      )}
      {isVideo && (showImage || showVideo) && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm"><Play className="ml-0.5 size-5 fill-white" aria-hidden /></span>
        </span>
      )}
    </span>
  );
}
