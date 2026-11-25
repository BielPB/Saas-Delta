"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, ChevronDown, Copy, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { Dialog, useToast } from "@/components/ui/overlay";
import { profileFields, type OnboardingItem } from "@/lib/client-sheet";
import { cn } from "@/lib/utils";
import { duplicateMonth, saveOnboarding, saveProfile } from "./client-actions";

/** "Etapas de onboarding x/9": checklist chips under the client header. */
export function OnboardingBar({ clientId, items, canEdit }: { clientId: string; items: OnboardingItem[]; canEdit: boolean }) {
  const [list, setList] = useState(items);
  const [open, setOpen] = useState(items.some((i) => !i.done));
  const [adding, setAdding] = useState("");
  const [, start] = useTransition();
  const toast = useToast();
  const done = list.filter((i) => i.done).length;
  const persist = (next: OnboardingItem[]) => {
    setList(next);
    start(async () => { const r = await saveOnboarding(clientId, next); if (!r.ok) toast.error(r.error); });
  };

  return (
    <section aria-label="Onboarding do cliente" className="mb-5 rounded-xl border border-border bg-surface">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Etapas de onboarding</span>
        <span className="tabular text-xs text-muted">{done}/{list.length}</span>
        <span className="h-1.5 max-w-40 flex-1 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full bg-accent" style={{ width: `${list.length ? (done / list.length) * 100 : 0}%` }} /></span>
        {done === list.length && <span className="text-xs font-medium text-[var(--tone-success-fg)]">Concluído</span>}
        <ChevronDown className={cn("ml-auto size-4 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-3">
          {list.map((i) => (
            <span key={i.id} className={cn("group inline-flex items-center rounded-full border text-xs", i.done ? "border-accent bg-accent/15" : "border-border")}>
              <button type="button" disabled={!canEdit} onClick={() => persist(list.map((x) => (x.id === i.id ? { ...x, done: !x.done } : x)))}
                aria-pressed={i.done} className={cn("inline-flex items-center gap-1.5 py-1 pl-2.5 pr-2", i.done ? "text-fg line-through decoration-muted" : "text-muted hover:text-fg")}>
                <span className={cn("flex size-3.5 items-center justify-center rounded-full border", i.done ? "border-accent bg-accent text-accent-fg" : "border-border-strong")}>
                  {i.done && <Check className="size-2.5" strokeWidth={3} aria-hidden />}
                </span>
                {i.label}
              </button>
              {canEdit && (
                <button type="button" aria-label={`Remover ${i.label}`} onClick={() => persist(list.filter((x) => x.id !== i.id))}
                  className="mr-1.5 hidden text-subtle hover:text-fg group-hover:inline"><X className="size-3" /></button>
              )}
            </span>
          ))}
          {canEdit && (
            <form className="inline-flex" onSubmit={(e) => { e.preventDefault(); const l = adding.trim(); if (!l) return; persist([...list, { id: crypto.randomUUID(), label: l, done: false }]); setAdding(""); }}>
              <label className="inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-2 py-0.5 text-xs text-muted focus-within:text-fg">
                <Plus className="size-3" aria-hidden />
                <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Nova etapa" aria-label="Nova etapa de onboarding" className="w-24 bg-transparent outline-none" />
              </label>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

/** "Ficha do cliente": the brand sheet. */
export function ProfileForm({ clientId, initial, canEdit }: { clientId: string; initial: Record<string, string>; canEdit: boolean }) {
  const [values, setValues] = useState(initial);
  const [pending, start] = useTransition();
  const toast = useToast();
  const dirty = profileFields.some((f) => (values[f.key] ?? "") !== (initial[f.key] ?? ""));
  return (
    <form className="max-w-3xl space-y-4" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveProfile(clientId, values); if (r.ok) toast.success(r.message ?? "Salvo."); else toast.error(r.error); }); }}>
      <p className="text-[13px] text-muted">Tudo que a equipe precisa saber antes de produzir para este cliente. Preencha uma vez e mantenha atualizado.</p>
      {profileFields.map((f) => (
        <label key={f.key} className="block">
          <span className="text-[13px] font-semibold">{f.label}</span>
          {f.hint && <span className="mt-0.5 block text-xs text-muted">{f.hint}</span>}
          <Textarea className="mt-1.5" rows={f.rows ?? 3} disabled={!canEdit} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
        </label>
      ))}
      {canEdit && (
        <div className="sticky bottom-0 flex justify-end border-t border-border bg-bg/95 py-3 backdrop-blur">
          <Button type="submit" variant="primary" disabled={pending || !dirty}>{pending && <Loader2 className="animate-spin" />} Salvar ficha</Button>
        </div>
      )}
    </form>
  );
}

/** "Duplicar mês": copy this month's posts to the next one. */
export function DuplicateMonth({ clientId, ym, monthLabel, nextLabel }: { clientId: string; ym: string; monthLabel: string; nextLabel: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = () => start(async () => {
    const r = await duplicateMonth(clientId, ym);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(r.message ?? "Mês duplicado.");
    setOpen(false);
    router.push(`/app/clientes/${clientId}?aba=posts&mes=${r.data!.target}`);
  });
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Copy /> Duplicar mês</Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="sm" title={`Duplicar ${monthLabel} para ${nextLabel}?`}
        description="Cria uma cópia de cada post do mês no mês seguinte, para usar como ponto de partida."
        footer={<><Button onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" disabled={pending} onClick={run}>{pending ? <Loader2 className="animate-spin" /> : <Copy />} Duplicar</Button></>}>
        <ul className="space-y-1.5 text-sm text-muted">
          <li>• Copia título, formato, subdivisão e briefing; a data vai para o mesmo dia do mês seguinte.</li>
          <li>• Os posts novos começam em <strong className="text-fg">Roteiro</strong>, sem arquivos nem legenda.</li>
          <li>• Os posts de {monthLabel} não mudam.</li>
        </ul>
      </Dialog>
    </>
  );
}

