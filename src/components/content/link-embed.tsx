import { ExternalLink, FolderOpen } from "lucide-react";
import { parseMediaLink } from "@/lib/media-link";

const ratioOf = (a: string | null | undefined) => (a === "16:9" ? "16 / 9" : a === "1:1" ? "1 / 1" : a === "4:5" ? "4 / 5" : "9 / 16");

/** Shows a Drive / YouTube / Vimeo link inline, or a clear "open" card for anything else (folders, other sites). */
export function LinkEmbed({ url, aspect, audience = "team" }: { url: string; aspect?: string | null; audience?: "team" | "client" }) {
  const link = parseMediaLink(url);
  if (!link) return null;
  const openBtn = (
    <a href={link.open} target="_blank" rel="noreferrer noopener"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted underline-offset-2 hover:text-fg hover:underline">
      <ExternalLink className="size-3.5" aria-hidden /> Abrir em outra aba
    </a>
  );

  if (link.kind === "drive" || link.kind === "youtube" || link.kind === "vimeo") {
    const r = ratioOf(aspect);
    return (
      <div>
        <div className="relative mx-auto w-full overflow-hidden rounded-2xl border border-border bg-black"
          style={{ aspectRatio: r, maxHeight: "72vh", maxWidth: `calc(72vh * (${r}))` }}>
          {/* iPhone Safari sizes an iframe to its content: the Drive player came out wider than the frame
              (black bar on the left, controls cut on the right). 1px + min-width 100% pins it to the frame. */}
          <iframe src={link.embed} title="Vídeo" className="absolute inset-0 h-full w-px min-w-full border-0" scrolling="no"
            allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" loading="lazy" />
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
