"use client";
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { ExternalLink, FolderOpen, Play } from "lucide-react";
import { driveStreamUrl, linkThumbnail, parseMediaLink } from "@/lib/media-link";

const ratioOf = (a: string | null | undefined) => (a === "16:9" ? "16 / 9" : a === "1:1" ? "1 / 1" : a === "4:5" ? "4 / 5" : "9 / 16");

/** Google API key handed down by the server at request time (see googleApiKey in lib/env). */
const DriveKey = createContext<string>("");
export function DriveKeyProvider({ value, children }: { value: string; children: ReactNode }) {
  return <DriveKey.Provider value={value}>{children}</DriveKey.Provider>;
}

/** Touch screens (phones, tablets). Server render assumes a computer; the phone switches right after loading. */
const TOUCH = "(pointer: coarse)";
function subscribeTouch(cb: () => void) {
  const m = window.matchMedia(TOUCH);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
const useTouch = () => useSyncExternalStore(subscribeTouch, () => window.matchMedia(TOUCH).matches, () => false);

/**
 * Shows a Drive / YouTube / Vimeo link inline, or a clear "open" card for anything else (folders, other sites).
 *
 * Drive videos (all tested on Safari, same engine as iPhone):
 * - Drive's embedded player lays itself out as 16:9: on iPhone a vertical video comes out cut, with the
 *   controls in the middle. It is NEVER used on touch screens.
 * - drive.usercontent.google.com is refused by Safari (CORP same-site + application/octet-stream).
 * - Relaying through our server would spend the Vercel Hobby origin-transfer quota (10 GB/month).
 * - The official Drive API (Google API key) answers with the real file type: the device's own player
 *   plays it. preload="none": nothing is downloaded before play and Safari keeps the still frame.
 * Without a key, or if the device can't play the file: phones get the still frame with a button that
 * opens the video in Drive; computers get Drive's player (it works there).
 */
export function LinkEmbed({ url, aspect, audience = "team" }: { url: string; aspect?: string | null; audience?: "team" | "client" }) {
  const link = parseMediaLink(url);
  const touch = useTouch();
  const ctxKey = useContext(DriveKey);
  const [failed, setFailed] = useState(false);
  const [noThumb, setNoThumb] = useState(false);
  if (!link) return null;
  const openBtn = (
    <a href={link.open} target="_blank" rel="noreferrer noopener"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted underline-offset-2 hover:text-fg hover:underline">
      <ExternalLink className="size-3.5" aria-hidden /> Abrir em outra aba
    </a>
  );

  if (link.kind === "drive" || link.kind === "youtube" || link.kind === "vimeo") {
    const r = ratioOf(aspect);
    const frame = { aspectRatio: r, maxHeight: "72vh", maxWidth: `calc(72vh * (${r}))` };
    const thumb = linkThumbnail(url);
    const stream = link.kind === "drive" && !failed ? driveStreamUrl(link.id, ctxKey || process.env.NEXT_PUBLIC_GOOGLE_API_KEY) : null;
    const driveNote = link.kind === "drive" && (
      <p className="text-xs text-muted">
        {audience === "client" ? "Se o vídeo não carregar, avise a agência para liberar o acesso." : "Não carregou? No Drive, compartilhe como “Qualquer pessoa com o link”."}
      </p>
    );

    if (stream) {
      return (
        <div>
          <div className="relative mx-auto w-full overflow-hidden rounded-2xl border border-border bg-black" style={frame}>
            <video key={stream} src={stream} poster={thumb ?? undefined} controls playsInline preload="none"
              className="absolute inset-0 size-full object-contain" onError={() => setFailed(true)} />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">{driveNote}{openBtn}</div>
        </div>
      );
    }

    if (link.kind === "drive" && touch) {
      return (
        <div>
          <a href={link.open} target="_blank" rel="noreferrer noopener" aria-label="Assistir o vídeo"
            className="relative mx-auto block w-full overflow-hidden rounded-2xl border border-border bg-black" style={frame}>
            {thumb && !noThumb && (
              // eslint-disable-next-line @next/next/no-img-element -- Drive thumbnail
              <img src={thumb} alt="" referrerPolicy="no-referrer" loading="lazy" className="absolute inset-0 size-full object-cover" onError={() => setNoThumb(true)} />
            )}
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/20">
              <span className="flex size-20 items-center justify-center rounded-full bg-black/65 shadow-lg">
                <Play className="ml-1 size-9 fill-white text-white" aria-hidden />
              </span>
              <span className="rounded-full bg-black/65 px-3 py-1.5 text-sm font-semibold text-white">Toque para assistir</span>
            </span>
          </a>
          <p className="mt-2 text-xs text-muted">O vídeo abre no Google Drive. Depois é só voltar para esta página.</p>
        </div>
      );
    }

    return (
      <div>
        <div className="relative mx-auto w-full overflow-hidden rounded-2xl border border-border bg-black" style={frame}>
          <iframe src={link.embed} title="Vídeo" className="absolute inset-0 size-full border-0"
            allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" loading="lazy" />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">{driveNote}{openBtn}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border-strong px-4 py-8 text-center">
      {link.kind === "drive-folder" && <FolderOpen className="size-6 text-muted" aria-hidden />}
      <p className="text-sm font-medium">{link.kind === "drive-folder" ? "Pasta do Google Drive" : "Arquivo em link externo"}</p>
      <p className="max-w-sm text-xs text-muted">
        {link.kind === "drive-folder"
          ? (audience === "client" ? "O material está nesta pasta." : "Uma pasta não pode ser exibida aqui. Para o cliente ver o vídeo direto, use o link do arquivo.")
          : "Este link não pode ser exibido aqui."}
      </p>
      <a href={link.open} target="_blank" rel="noreferrer noopener"
        className="mt-1 inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg">
        <ExternalLink className="size-4" aria-hidden /> Abrir {link.kind === "drive-folder" ? "pasta" : "link"}
      </a>
    </div>
  );
}
