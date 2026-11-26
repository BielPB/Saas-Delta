"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Check, Copy, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/overlay";
import { Badge, EmptyState } from "@/components/ui/primitives";
import { approvalStatus, type ApprovalStatus } from "@/lib/domain";
import { formatDate, toLocalInput } from "@/lib/format";
import { createBatch } from "../actions";

interface C { id: string; code: number; title: string; service: string | null; serviceId: string | null; planned: string | null; ready: boolean; approval: string; format: string }

function defaultExpiry(sensitive: boolean) {
  return toLocalInput(new Date(Date.now() + (sensitive ? 7 : 15) * 864e5).toISOString());
}

function weekKey(iso: string) {
  const d = new Date(iso); const day = d.getDay(); d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

export function BatchBuilder({ clients, clientId, sensitive, contents, preselected }: {
  clients: Array<{ id: string; name: string }>; clientId?: string; sensitive: boolean; contents: C[]; preselected: string[];
}) {
  const router = useRouter();
  const ready = contents.filter((c) => c.ready);
  const [sel, setSel] = useState(new Set(preselected.filter((id) => ready.some((c) => c.id === id))));
  const [name, setName] = useState(() => `Aprovação ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date())}`);
  const [expires, setExpires] = useState(() => defaultExpiry(sensitive));
  const [due, setDue] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; expires_at: string } | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();

  const services = useMemo(() => [...new Map(ready.filter((c) => c.serviceId).map((c) => [c.serviceId!, c.service!])).entries()], [ready]);
  const weeks = useMemo(() => [...new Set(ready.filter((c) => c.planned).map((c) => weekKey(c.planned!)))].sort(), [ready]);
  const months = useMemo(() => [...new Set(ready.filter((c) => c.planned).map((c) => c.planned!.slice(0, 7)))].sort(), [ready]);
  const pick = (ids: string[]) => setSel(new Set(ids));

  if (result) {
    const msg = `Olá! Os conteúdos de ${clients.find((c) => c.id === clientId)?.name} estão prontos para sua avaliação: ${result.url}${pin ? `\nPIN: ${pin}` : ""}`;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-[15px] font-semibold"><Check className="size-5 text-[var(--tone-success-fg)]" /> Link gerado</div>
        <p className="text-sm text-muted">Copie agora: por segurança o link não pode ser exibido novamente (só o hash é armazenado). Se perder, gere um novo no lote.</p>
        <div className="flex gap-2"><Input readOnly value={result.url} onFocus={(e) => e.target.select()} aria-label="Link de aprovação" className="font-mono text-xs" />
          <Button onClick={() => navigator.clipboard.writeText(result.url).then(() => toast.success("Link copiado."))}><Copy /> Copiar</Button></div>
        {pin && <p className="text-sm">PIN do link: <span className="font-mono font-semibold">{pin}</span> <span className="text-muted">(envie por um canal separado quando o material for sensível)</span></p>}
        <div className="flex flex-wrap gap-2">
          <a className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-medium text-accent-fg" target="_blank" rel="noreferrer noopener"
            href={`https://wa.me/?text=${encodeURIComponent(msg)}`}><MessageCircle className="size-4" /> Enviar pelo WhatsApp</a>
          <Button onClick={() => router.push("/app/aprovacoes")}>Ver lotes</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <label className="block max-w-sm text-[13px] font-medium">Cliente
        <Select className="mt-1.5" value={clientId ?? ""} onChange={(e) => router.push(`/app/aprovacoes/novo?cliente=${e.target.value}`)}>
          <option value="">Selecione…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </label>

      {clientId && (contents.length === 0 ? <EmptyState compact title="Nenhum conteúdo em aberto para este cliente" /> : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="text-muted">Selecionar:</span>
            <Button size="sm" onClick={() => pick(ready.map((c) => c.id))}>Todos prontos ({ready.length})</Button>
            <Button size="sm" onClick={() => pick(ready.filter((c) => c.approval === "not_sent").map((c) => c.id))}>Ainda não enviados</Button>
            {services.length > 0 && (
              <Select aria-label="Por subdivisão" className="h-8 w-auto text-[13px]" value="" onChange={(e) => pick(ready.filter((c) => c.serviceId === e.target.value).map((c) => c.id))}>
                <option value="">Por subdivisão…</option>{services.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              </Select>
            )}
            {weeks.length > 0 && (
              <Select aria-label="Por semana" className="h-8 w-auto text-[13px]" value="" onChange={(e) => pick(ready.filter((c) => c.planned && weekKey(c.planned) === e.target.value).map((c) => c.id))}>
                <option value="">Lote semanal…</option>{weeks.map((w) => <option key={w} value={w}>Semana de {formatDate(`${w}T12:00:00`)}</option>)}
              </Select>
            )}
            {months.length > 0 && (
              <Select aria-label="Por mês" className="h-8 w-auto text-[13px]" value="" onChange={(e) => pick(ready.filter((c) => c.planned?.startsWith(e.target.value)).map((c) => c.id))}>
                <option value="">Lote mensal…</option>{months.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            )}
            {sel.size > 0 && <Button size="sm" variant="ghost" onClick={() => pick([])}>Limpar</Button>}
          </div>
          <ul className="max-h-[420px] divide-y divide-border overflow-y-auto rounded-md border border-border">
            {contents.map((c) => (
              <li key={c.id}>
                <label className={`flex items-center gap-3 px-3 py-2 text-[13px] pointer-coarse:py-3 ${c.ready ? "cursor-pointer hover:bg-surface-2" : "opacity-60"}`}>
                  <input type="checkbox" className="size-4 accent-[var(--fg)]" disabled={!c.ready} checked={sel.has(c.id)}
                    onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(c.id); else n.delete(c.id); setSel(n); }} />
                  <span className="min-w-0 flex-1 truncate"><span className="font-mono text-xs text-subtle">#{c.code}</span> {c.title}
                    <span className="text-muted"> · {c.format}{c.service ? ` · ${c.service}` : ""}</span></span>
                  {c.planned && <span className="tabular hidden shrink-0 text-xs text-muted sm:inline">{formatDate(c.planned)}</span>}
                  {c.ready ? <Badge tone={approvalStatus[c.approval as ApprovalStatus].tone}>{approvalStatus[c.approval as ApprovalStatus].label}</Badge> : <Badge>Falta revisão interna</Badge>}
                </label>
              </li>
            ))}
          </ul>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-[13px] font-medium">Nome do lote<Input className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="text-[13px] font-medium">Prazo para o cliente avaliar <span className="font-normal text-muted">(opcional)</span>
              <Input className="mt-1.5" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></label>
            <label className="text-[13px] font-medium">Link expira em<Input className="mt-1.5" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
              {sensitive && <span className="mt-1 block text-xs font-normal text-[var(--tone-warning-fg)]">Cliente sensível: máximo de 30 dias.</span>}</label>
            <label className="text-[13px] font-medium">PIN {sensitive ? <span className="text-[var(--tone-danger-fg)]">(obrigatório)</span> : <span className="font-normal text-muted">(opcional)</span>}
              <Input className="mt-1.5" inputMode="numeric" pattern="\d{4,8}" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="4 a 8 dígitos" /></label>
          </div>
          <FormError message={error} />
          <Button variant="primary" disabled={pending || sel.size === 0 || (sensitive && pin.length < 4)}
            onClick={() => start(async () => {
              setError(null);
              const r = await createBatch({ client_id: clientId, name, content_ids: [...sel], due_at: due || undefined, expires_at: expires || undefined, pin });
              if (r.ok && r.data) setResult(r.data); else if (!r.ok) setError(r.error);
            })}>
            Gerar link para {sel.size} conteúdo(s)
          </Button>
        </>
      ))}
    </div>
  );
}
