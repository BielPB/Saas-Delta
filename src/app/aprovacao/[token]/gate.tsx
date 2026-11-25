"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, Lock, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { openPortalAction } from "./actions";

export function Unavailable() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-2"><Lock className="size-5 text-muted" /></div>
      <h1 className="text-lg font-semibold">Link indisponível</h1>
      <p className="mt-2 text-sm text-muted">Este link de aprovação expirou ou foi revogado. Peça um novo link para a agência.</p>
    </main>
  );
}

export function PortalGate({ token }: { token: string }) {
  const [needsPin, setNeedsPin] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const open = (p: string | null) => start(async () => {
    setError(null);
    const r = await openPortalAction(token, p);
    if (!r.ok) { if (r.code === "link_unavailable") setGone(true); else setError(r.error); return; }
    if (r.data?.requiresPin) { setNeedsPin(true); return; }
    router.refresh();
  });
  useEffect(() => { open(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (gone) return <Unavailable />;
  if (!needsPin) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-6 text-center" aria-busy={!error}>
        {error ? (
          <div role="alert">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-surface-2"><WifiOff className="size-5 text-muted" /></div>
            <h1 className="text-lg font-semibold">Não conseguimos carregar a avaliação</h1>
            <p className="mt-2 text-sm text-muted">Verifique sua conexão e tente de novo. Suas avaliações já enviadas estão salvas.</p>
            <Button variant="primary" className="mt-5 h-11 w-full" disabled={pending} onClick={() => open(null)}>
              {pending && <Loader2 className="animate-spin" />} Tentar novamente
            </Button>
          </div>
        ) : <Loader2 className="size-6 animate-spin text-muted" aria-label="Carregando" />}
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-2"><Lock className="size-5" /></div>
      <h1 className="text-lg font-semibold">Material protegido</h1>
      <p className="mt-1 text-sm text-muted">Digite o PIN enviado pela agência para ver os conteúdos.</p>
      <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); open(pin); }}>
        <Input inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={8} value={pin} aria-label="PIN"
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="h-12 text-center font-mono text-xl tracking-[0.4em]" />
        {error && <p role="alert" className="text-sm text-[var(--tone-danger-fg)]">{error}</p>}
        <Button type="submit" variant="primary" className="h-11 w-full" disabled={pending || pin.length < 4}>
          {pending && <Loader2 className="animate-spin" />} Acessar
        </Button>
      </form>
    </main>
  );
}
