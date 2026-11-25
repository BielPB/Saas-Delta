"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, RefreshCw, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Dialog, useToast } from "@/components/ui/overlay";
import { toLocalInput } from "@/lib/format";
import { revokeLink, rotateLink } from "../actions";

function defaultExpiry(sensitive: boolean) {
  return toLocalInput(new Date(Date.now() + (sensitive ? 7 : 15) * 864e5).toISOString());
}

export function LinkControls({ batchId, liveLinkId, sensitive }: { batchId: string; liveLinkId: string | null; sensitive: boolean }) {
  const [rotate, setRotate] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [expires, setExpires] = useState(() => defaultExpiry(sensitive));
  const [pin, setPin] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Button size="sm" onClick={() => setRotate(true)}><RefreshCw /> {liveLinkId ? "Gerar novo link" : "Gerar link"}</Button>
      {liveLinkId && <Button size="sm" variant="danger" onClick={() => setConfirmRevoke(true)}><ShieldX /> Revogar</Button>}

      <Dialog open={confirmRevoke} onClose={() => setConfirmRevoke(false)} size="sm" title="Revogar link?" description="O cliente perde o acesso imediatamente, inclusive com a página aberta."
        footer={<><Button onClick={() => setConfirmRevoke(false)}>Cancelar</Button>
          <Button variant="danger" disabled={pending} onClick={() => start(async () => {
            const r = await revokeLink(liveLinkId!, batchId); setConfirmRevoke(false);
            if (r.ok) { toast.success(r.message ?? "Revogado."); router.refresh(); } else toast.error(r.error);
          })}>Revogar agora</Button></>} />

      <Dialog open={rotate} onClose={() => { setRotate(false); setUrl(null); }} title="Novo link de acesso" description="O link atual, se existir, é revogado. O cliente continua vendo as mesmas avaliações e versões.">
        {url ? (
          <div className="space-y-2">
            <div className="flex gap-2"><Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Novo link" />
              <Button onClick={() => navigator.clipboard.writeText(url).then(() => toast.success("Link copiado."))}><Copy /> Copiar</Button></div>
            <p className="text-xs text-muted">Copie agora: o link não é exibido de novo.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-[13px] font-medium">Expira em<Input className="mt-1" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
            <label className="block text-[13px] font-medium">PIN {sensitive ? "(obrigatório)" : "(opcional)"}<Input className="mt-1" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></label>
            <Button variant="primary" disabled={pending || (sensitive && pin.length < 4)} onClick={() => start(async () => {
              const r = await rotateLink(batchId, expires, pin || null);
              if (r.ok && r.data) { setUrl(r.data.url); router.refresh(); } else if (!r.ok) toast.error(r.error);
            })}>Gerar link</Button>
          </div>
        )}
      </Dialog>
    </div>
  );
}
