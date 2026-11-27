"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, useToast } from "@/components/ui/overlay";
import { sendVideosForApproval } from "./post-actions";

/** "Link dos vídeos": every video of the month in one link, which the client watches as a list. */
export function VideoApprovalButton({ clientId, clientName, ym, contentIds }: { clientId: string; clientName: string; ym: string; contentIds: string[] }) {
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ url: string; pin: string | null; sent: number; skipped: number } | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const [y, m] = ym.split("-");
  const monthLabel = `${m}/${y}`;

  const send = () => start(async () => {
    const r = await sendVideosForApproval(clientId, ym, contentIds);
    if (!r.ok) { toast.error(r.error); return; }
    setConfirm(false); setResult(r.data!); router.refresh();
  });
  const message = result ? `Vídeos — ${clientName} · ${monthLabel}\nAssista e aprove os vídeos:\n${result.url}${result.pin ? "\n(o PIN segue em outra mensagem)" : ""}` : "";

  return (
    <>
      <Button size="sm" onClick={() => setConfirm(true)} disabled={!contentIds.length}><Send /> Link dos vídeos</Button>

      <Dialog open={confirm} onClose={() => setConfirm(false)} size="sm" title={`Link com os vídeos de ${monthLabel}`}
        description="O cliente abre e vê todos os vídeos em sequência, com Aprovar e Pedir ajuste embaixo de cada um."
        footer={<><Button onClick={() => setConfirm(false)}>Cancelar</Button>
          <Button variant="primary" disabled={pending} onClick={send}>{pending ? <Loader2 className="animate-spin" /> : <Send />} Gerar link</Button></>}>
        <ul className="space-y-1.5 text-sm text-muted">
          <li>• Entram os vídeos deste mês que já têm o arquivo ou o link do Drive e ainda não foram aprovados.</li>
          <li>• Os que ainda não têm o vídeo ficam de fora.</li>
          <li>• É um link separado do link do mês (preview do feed).</li>
        </ul>
      </Dialog>

      <Dialog open={result !== null} onClose={() => setResult(null)} size="sm" title="Link dos vídeos pronto"
        description={result ? `${result.sent} vídeo(s) no link.${result.skipped ? ` ${result.skipped} ficaram de fora.` : ""} Copie agora: por segurança ele não é mostrado de novo.` : undefined}>
        {result && (
          <div className="space-y-3">
            <p className="break-all rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs">{result.url}</p>
            {result.pin && <p className="text-sm">PIN do link: <strong className="tabular">{result.pin}</strong> <span className="text-muted">(mande em outra mensagem)</span></p>}
            <div className="flex flex-wrap gap-2">
              <Button className="flex-1" onClick={() => navigator.clipboard.writeText(result.url).then(() => toast.success("Link copiado."))}><Copy /> Copiar link</Button>
              <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer noopener"
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-semibold text-accent-fg">
                <MessageCircle className="size-4" aria-hidden /> Enviar no WhatsApp
              </a>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
