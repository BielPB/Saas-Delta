"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Loader2, MessageCircle, Play, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, useToast } from "@/components/ui/overlay";
import type { PostStatusKey } from "@/lib/post-status";
import { cn } from "@/lib/utils";
import { reorderFeed, resetFeedOrder, sendFeedForApproval } from "./post-actions";
import { MediaPreview, StatusPill } from "./post-grid";

export interface FeedTile { id: string; title: string; thumb: string | null; link: boolean; video: boolean; videoSrc?: string | null; status: PostStatusKey; ready: boolean; missing: boolean; blocked: string | null; href: string }

/** Instagram-like 3-column preview of the month (newest first), with one button to send it to the client. */
export function FeedApproval({ tiles: initialTiles, clientId, clientName, ym, monthLabel, canSend, activeLink, customOrder }: {
  tiles: FeedTile[]; clientId: string; clientName: string; ym: string; monthLabel: string; canSend: boolean;
  /** The month's link the client already has ("Mês ativo no link"). */
  activeLink: { expires: string | null; lastAccess: string | null; posts: number } | null;
  customOrder: boolean;
}) {
  const [order, setOrder] = useState<string[] | null>(null); // optimistic order while dragging
  const [custom, setCustom] = useState(customOrder);
  const [drag, setDrag] = useState<string | null>(null);
  const byId = new Map(initialTiles.map((t) => [t.id, t]));
  const tiles = order ? order.map((id) => byId.get(id)).filter((t): t is FeedTile => Boolean(t)) : initialTiles;
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ url: string | null; existing: boolean; pin: string | null; sent: number; skipped: number } | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const open = tiles.filter((t) => !["ready", "scheduled", "published", "cancelled"].includes(t.status));
  const willGo = open.filter((t) => !t.missing).length;
  const notReady = open.filter((t) => t.missing).length;
  const approved = tiles.filter((t) => ["ready", "scheduled", "published"].includes(t.status)).length;

  const saveOrder = (ids: string[]) => start(async () => {
    setOrder(ids);
    const r = await reorderFeed(clientId, ym, ids);
    if (!r.ok) { toast.error(r.error); setOrder(null); return; }
    router.refresh();
  });
  const setMode = (next: boolean) => {
    setCustom(next);
    if (next) saveOrder(tiles.map((t) => t.id));
    else start(async () => { const r = await resetFeedOrder(clientId, ym); if (!r.ok) toast.error(r.error); setOrder(null); router.refresh(); });
  };
  const dropOn = (targetId: string) => {
    if (!drag || drag === targetId) return;
    const ids = tiles.map((t) => t.id).filter((id) => id !== drag);
    ids.splice(ids.indexOf(targetId), 0, drag);
    setDrag(null);
    saveOrder(ids);
  };
  /** Touch screens have no drag: move one place back (-1) or forward (+1). */
  const nudge = (id: string, dir: -1 | 1) => {
    const ids = tiles.map((t) => t.id);
    const from = ids.indexOf(id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    saveOrder(ids);
  };

  const send = () => start(async () => {
    const r = await sendFeedForApproval(clientId, ym, open.map((t) => t.id));
    if (!r.ok) { toast.error(r.error); return; }
    setConfirm(false); setResult(r.data!); router.refresh();
  });
  const message = result?.url ? `Preview — ${clientName} · ${monthLabel}\nConfira e aprove as publicações:\n${result.url}${result.pin ? `\n(o PIN segue em outra mensagem)` : ""}` : "";

  return (
    <section aria-label="Preview do feed">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Preview do feed · {tiles.length} publicaç{tiles.length === 1 ? "ão" : "ões"}</p>
          <p className="mt-0.5 text-[13px] text-muted">Como o perfil vai ficar em {monthLabel}, do mais novo para o mais antigo. {approved > 0 && <>{approved} já aprovada(s).</>}</p>
          <p className="mt-1.5 text-xs">
            {activeLink ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 font-medium text-accent-ink">
                <span className="size-1.5 rounded-full bg-accent-ink" aria-hidden /> Mês ativo no link · {activeLink.posts} post(s){activeLink.lastAccess ? " · cliente já abriu" : " · ainda não aberto"}
              </span>
            ) : <span className="text-muted">Nenhum link de {monthLabel} ainda. O primeiro envio cria o link do mês.</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {tiles.length > 1 && (
          <nav aria-label="Ordem do feed" className="flex rounded-full border border-border p-0.5 text-[11px] font-semibold">
            <button type="button" onClick={() => custom && setMode(false)} aria-pressed={!custom} className={cn("rounded-full px-2.5 py-1 text-muted pointer-coarse:py-2", !custom && "bg-surface-3 text-fg")}>Por data</button>
            <button type="button" onClick={() => !custom && setMode(true)} aria-pressed={custom} className={cn("rounded-full px-2.5 py-1 text-muted pointer-coarse:py-2", custom && "bg-surface-3 text-fg")}>Personalizada</button>
          </nav>
        )}
        {canSend && (
          <Button variant="primary" disabled={willGo === 0} onClick={() => setConfirm(true)}><Send /> {activeLink ? "Adicionar ao link do mês" : "Enviar para aprovação"}{willGo ? ` (${willGo})` : ""}</Button>
        )}
        </div>
      </div>

      {custom && tiles.length > 1 && (
        <p className="mb-2 text-center text-xs text-muted">
          <span className="pointer-coarse:hidden">Arraste as publicações</span><span className="hidden pointer-coarse:inline">Use as setas nas publicações</span> para montar o feed. O link do cliente segue esta ordem.
        </p>
      )}
      {tiles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-14 text-center text-sm text-muted">Nenhum post ou reels neste mês.</div>
      ) : (
        <ul className="mx-auto grid max-w-2xl grid-cols-3 gap-0.5">
          {tiles.map((t) => (
            <li key={t.id} draggable={custom} onDragStart={() => setDrag(t.id)} onDragEnd={() => setDrag(null)}
              onDragOver={(e) => { if (custom && drag) e.preventDefault(); }} onDrop={() => dropOn(t.id)}
              className={cn("relative min-w-0 overflow-hidden bg-surface-2 first:rounded-tl-xl [&:nth-child(3)]:rounded-tr-xl",
                custom && "cursor-grab active:cursor-grabbing", drag === t.id && "opacity-40", drag && drag !== t.id && "ring-2 ring-inset ring-transparent hover:ring-accent-ink/50")}>
              <Link href={t.href} scroll={false} draggable={false} className="group block size-full" title={t.title}>
                <span className="relative block aspect-[4/5]">
                  <MediaPreview thumb={t.thumb} video={t.videoSrc ?? null} link={t.link} isVideo={t.video} />
                  {t.video && <Play className="absolute right-1.5 top-1.5 size-4 fill-white text-white drop-shadow" aria-label="Vídeo" />}
                </span>
                <span className="flex p-1.5 justify-start opacity-90 transition-opacity group-hover:opacity-100">
                  {t.missing && !["ready", "scheduled", "published"].includes(t.status)
                    ? <span className="wrap-anywhere whitespace-normal rounded-lg bg-black/75 px-2 py-0.5 text-[10.5px] font-semibold text-white">{t.blocked ?? "Faltam arquivos"}</span>
                    : <StatusPill s={t.status} className="shadow" />}
                </span>
              </Link>
              {custom && (
                <span className="absolute inset-x-1 top-1/2 hidden -translate-y-1/2 justify-between pointer-coarse:flex">
                  {([-1, 1] as const).map((dir) => {
                    const n = tiles.findIndex((x) => x.id === t.id) + dir;
                    return (
                      <button key={dir} type="button" disabled={pending || n < 0 || n >= tiles.length} onClick={() => nudge(t.id, dir)}
                        aria-label={dir < 0 ? `Mover ${t.title} para trás` : `Mover ${t.title} para frente`}
                        className="flex size-9 items-center justify-center rounded-full bg-black/65 text-white shadow disabled:invisible">
                        {dir < 0 ? <ChevronLeft className="size-5" aria-hidden /> : <ChevronRight className="size-5" aria-hidden />}
                      </button>
                    );
                  })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={confirm} onClose={() => setConfirm(false)} size="sm" title={`Enviar o feed de ${monthLabel}?`}
        footer={<><Button onClick={() => setConfirm(false)}>Cancelar</Button>
          <Button variant="primary" disabled={pending || willGo === 0} onClick={send}>{pending ? <Loader2 className="animate-spin" /> : <Send />} Gerar link</Button></>}>
        <ul className="space-y-2 text-sm">
          <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[var(--tone-success-fg)]" aria-hidden /><span><strong>{willGo}</strong> post(s) vão para o cliente aprovar no link.</span></li>
          {notReady > 0 && (
            <li className="flex gap-2"><X className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /><span className="text-muted"><strong>{notReady}</strong> ficam de fora por enquanto:
              <ul className="mt-1 space-y-0.5 text-xs">{open.filter((t) => t.missing).slice(0, 5).map((t) => <li key={t.id}>• {t.title}: {t.blocked}</li>)}</ul></span></li>
          )}
          <li className="text-xs text-muted">{activeLink ? "Eles entram no link de " + monthLabel + " que o cliente já tem: não precisa mandar outro." : "Será criado o link do mês: os próximos envios entram nele."} Posts já aprovados não entram de novo.</li>
        </ul>
      </Dialog>

      <Dialog open={result !== null} onClose={() => setResult(null)} size="sm" title={result?.url ? "Link de aprovação pronto" : "Adicionados ao link do mês"}
        description={result ? (result.url
          ? `${result.sent} post(s) no link.${result.skipped ? ` ${result.skipped} ficaram de fora.` : ""} Copie agora: por segurança ele não é mostrado de novo.`
          : `${result.sent} post(s) entraram no link de ${monthLabel} que o cliente já recebeu. Ele vê os novos posts no mesmo endereço.`) : undefined}>
        {result?.url && (
          <div className="space-y-3">
            <p className="break-all rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs">{result.url}</p>
            {result.pin && <p className="text-sm">PIN do link: <strong className="tabular">{result.pin}</strong> <span className="text-muted">(mande em outra mensagem)</span></p>}
            <div className="flex flex-wrap gap-2">
              <Button className="flex-1" onClick={() => navigator.clipboard.writeText(result.url!).then(() => toast.success("Link copiado."))}><Copy /> Copiar link</Button>
              <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer noopener"
                className={cn("inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-semibold text-accent-fg")}>
                <MessageCircle className="size-4" aria-hidden /> Enviar no WhatsApp
              </a>
            </div>
          </div>
        )}
        {result && !result.url && (
          <a href={`https://wa.me/?text=${encodeURIComponent(`Oi! Adicionamos ${result.sent} publicação(ões) no preview de ${monthLabel}. É só abrir o mesmo link de antes.`)}`} target="_blank" rel="noreferrer noopener"
            className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-semibold text-accent-fg">
            <MessageCircle className="size-4" aria-hidden /> Avisar o cliente no WhatsApp
          </a>
        )}
      </Dialog>
    </section>
  );
}
