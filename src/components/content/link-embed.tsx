"use client";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, FolderOpen } from "lucide-react";
import { linkThumbnail, parseMediaLink } from "@/lib/media-link";

const ratioOf = (a: string | null | undefined) => (a === "16:9" ? "16 / 9" : a === "1:1" ? "1 / 1" : a === "4:5" ? "4 / 5" : "9 / 16");

/**
 * Shows a Drive / YouTube / Vimeo link inline, or a clear "open" card for anything else (folders, other sites).
 * Drive files play in the browser's own player (the file comes straight from Drive): Drive's embedded
 * player came out cut on iPhone for vertical videos. If the browser can't play the file (not shared,
 * a format it doesn't read), it falls back to Drive's player.
 */
export function LinkEmbed({ url, aspect, audience = "team", preload = "metadata" }: {
  url: string; aspect?: string | null; audience?: "team" | "client"; preload?: "metadata" | "none";
}) {
  const link = parseMediaLink(url);
  const [driveFallback, setDriveFallback] = useState(false);
  if (!link) return null;
  const openBtn = (
    <a href={link.open} target="_blank" rel="noreferrer noopener"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted underline-offset-2 hover:text-fg hover:underline">
      <ExternalLink className="size-3.5" aria-hidden /> Abrir em outra aba
    </a>
  );

  if (link.kind === "drive" || link.kind === "youtube" || link.kind === "vimeo") {
    const r = ratioOf(aspect);
    const native = link.kind === "drive" && !driveFallback;
    return (
      <div>
        <div className="relative mx-auto w-full overflow-hidden rounded-2xl border border-border bg-black"
          style={{ aspectRatio: r, maxHeight: "72vh", maxWidth: `calc(72vh * (${r}))` }}>
          {native ? (
            <DriveVideo key={link.direct} src={link.direct} poster={linkThumbnail(url)} preload={preload} onFail={() => setDriveFallback(true)} />
          ) : (
            <iframe src={link.embed} title="Vídeo" className="absolute inset-0 h-full w-px min-w-full border-0" scrolling="no"
              allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" loading="lazy" />
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          {link.kind === "drive" && (
            <p className="text-xs text-muted">
              {audience === "client" ? "Se o vídeo não carregar, avise a agência para liberar o acesso." : "Não carregou? No Drive, compartilhe como “Qualquer pessoa com o link”."}
            </p>
          )}
          {openBtn}
        </div>
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

/**
 * Plays a Drive file with the browser's own player. Two details make Drive files playable:
 * - crossOrigin: Drive answers "Cross-Origin-Resource-Policy: same-site", which blocks a plain <video>
 *   on another site; a CORS request is allowed (Drive sends "Access-Control-Allow-Origin: *").
 * - <source type>: Drive labels every file "application/octet-stream". Safari takes the type from the
 *   <source> tag, so iPhone videos (.mov, often HEVC) are read as video. Browsers that don't play
 *   QuickTime skip to the second source; if nothing plays, onFail switches to Drive's player.
 */
function DriveVideo({ src, poster, preload, onFail }: { src: string; poster: string | null; preload: "metadata" | "none"; onFail: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const failRef = useRef(onFail);
  useEffect(() => { failRef.current = onFail; });
  useEffect(() => {
    const v = ref.current;
    const last = v?.querySelector("source:last-of-type");
    if (!v || !last) return;
    const fail = () => failRef.current();
    last.addEventListener("error", fail); // with <source> children, errors fire on the source, not the video
    v.addEventListener("error", fail);
    return () => { last.removeEventListener("error", fail); v.removeEventListener("error", fail); };
  }, []);
  return (
    <video ref={ref} crossOrigin="anonymous" poster={poster ?? undefined} controls playsInline preload={preload}
      className="absolute inset-0 size-full object-contain">
      <source src={src} type="video/quicktime" />
      <source src={src} type="video/mp4" />
    </video>
  );
}
