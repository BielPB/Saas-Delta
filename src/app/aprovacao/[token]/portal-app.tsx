"use client";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { ArrowRight, Check, CheckCheck, ChevronLeft, ChevronRight, Copy, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea, Input } from "@/components/ui/form";
import { Dialog, useToast } from "@/components/ui/overlay";
import type { PortalData, PortalDeliverable } from "@/lib/portal";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { bulkApproveAction, finalizeAction, respondAction } from "./actions";

const kindLabel: Record<string, string> = { video: "Vídeo", cover: "Capa", caption: "Legenda", image: "Arte", carousel: "Carrossel", other: "Material" };
const ratio = (a: string | null) => (a === "16:9" ? "16 / 9" : a === "1:1" ? "1 / 1" : a === "4:5" ? "4 / 5" : "9 / 16");
const order = (k: string) => ({ video: 0, carousel: 1, image: 1, cover: 2, caption: 3 } as Record<string, number>)[k] ?? 4;

type Summary = { approved_contents: number; adjustment_contents: number; pending_items: number; total_contents: number; received_at: string };
type Choice = "approved" | "rejected";
interface Draft { choice?: Choice; comment: string; flagged: string[] }

function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}
function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
const dueLabel = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "long", timeZone: "America/Fortaleza" });

export function PortalApp({ token, data, media }: { token: string; data: PortalData; media: Record<string, string> }) {
  const nameKey = `df-reviewer:${data.batch.id}`;
  const stored = useSyncExternalStore(subscribeStorage, () => readStored(nameKey), () => undefined);
  const [typed, setReviewer] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const reviewer = typed ?? stored ?? "";
  const askName = stored === null && !dismissed;
  const setAskName = (v: boolean) => { if (!v) setDismissed(true); };
  const [idx, setIdx] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const total = data.items.length;
  const item = data.items[Math.min(idx, total - 1)];

  /** Content-level state derived from its deliverable decisions. */
  const stateOf = (it: PortalData["items"][number]): "approved" | "rejected" | "pending" | "none" => {
    const ds = it.deliverables.filter((d) => d.version?.decidable);
    if (!ds.length) return "none";
    if (ds.some((d) => d.version!.status === "rejected")) return "rejected";
    if (ds.every((d) => d.version!.status === "approved")) return "approved";
    return "pending";
  };
  const answered = data.items.filter((i) => ["approved", "rejected"].includes(stateOf(i))).length;

  const sendOne = async (version: string, decision: Choice, comment: string | null) => {
    const r = await respondAction(token, { version, decision, comment, reviewer: reviewer || null, key: crypto.randomUUID(), override: false });
    return r;
  };

  /** Saves the current content's draft (if any). Returns false when it must stay on this content. */
  const save = async (): Promise<boolean> => {
    const d = drafts[item.content_id];
    if (!d?.choice) return true;
    const decidable = item.deliverables.filter((x) => x.version?.decidable);
    if (d.choice === "approved") {
      if (decidable.every((x) => x.version!.status === "approved")) return true;
      const r = await bulkApproveAction(token, { content: item.content_id, reviewer: reviewer || null, key: crypto.randomUUID(), includeRejected: true });
      if (!r.ok) { toast.error(r.error); if (r.code === "session_invalid") router.refresh(); return false; }
      return true;
    }
    if (d.flagged.length === 0) { toast.error("Marque o que precisa ser ajustado."); return false; }
    if (d.comment.trim().length < 3) { toast.error("Escreva o que precisa ser ajustado (mínimo de 3 caracteres)."); return false; }
    for (const x of decidable) {
      const flagged = d.flagged.includes(x.deliverable_id);
      if (flagged) {
        if (x.version!.status === "rejected" && x.decision?.comment === d.comment.trim()) continue;
        const r = await sendOne(x.version!.id, "rejected", d.comment.trim());
        if (!r.ok) { toast.error(r.error); if (r.code === "stale" || r.code === "session_invalid") router.refresh(); return false; }
      } else if (x.version!.status === "pending") {
        const r = await sendOne(x.version!.id, "approved", null);
        if (!r.ok) { toast.error(r.error); if (r.code === "stale" || r.code === "session_invalid") router.refresh(); return false; }
      }
    }
    return true;
  };

  const go = (to: number) => start(async () => {
    const hadDraft = Boolean(drafts[item.content_id]?.choice);
    if (!(await save())) return;
    if (hadDraft) {
      // Decisions were written: clear the draft and reload the server state.
      setDrafts((p) => { const n = { ...p }; delete n[item.content_id]; return n; });
      router.refresh();
    }
    setIdx(Math.max(0, Math.min(total - 1, to)));
    window.scrollTo({ top: 0 });
  });

  const finalize = () => start(async () => {
    if (!(await save())) return;
    setDrafts((p) => { const n = { ...p }; delete n[item.content_id]; return n; });
    const r = await finalizeAction(token, reviewer || null);
    if (!r.ok) { toast.error(r.error); return; }
    setSummary(r.data!);
    router.refresh();
    window.scrollTo({ top: 0 });
  });

  if (summary) {
    const needAdjust = data.items.filter((i) => i.deliverables.some((d) => d.version?.decidable && d.version.status === "rejected"));
    return (
      <main className="mx-auto min-h-dvh max-w-xl px-5 py-10">
        <Brand data={data} media={media} />
        <div className="mt-8 rounded-2xl border border-border bg-surface p-6">
          <div className="flex items-center gap-2 text-lg font-bold"><CheckCheck className="size-5 text-[var(--tone-success-fg)]" /> Avaliação recebida</div>
          <p className="mt-1 text-sm text-muted">Recebemos sua avaliação em {formatDateTime(summary.received_at)}. A agência já foi avisada.</p>
          <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-[var(--tone-success-bg)] p-3"><dt className="text-xs text-[var(--tone-success-fg)]">Aprovados</dt><dd className="tabular text-2xl font-bold">{summary.approved_contents}</dd></div>
            <div className="rounded-xl bg-[var(--tone-warning-bg)] p-3"><dt className="text-xs text-[var(--tone-warning-fg)]">Com ajustes</dt><dd className="tabular text-2xl font-bold">{summary.adjustment_contents}</dd></div>
            <div className="rounded-xl bg-surface-2 p-3"><dt className="text-xs text-muted">Itens pendentes</dt><dd className="tabular text-2xl font-bold">{summary.pending_items}</dd></div>
          </dl>
          {needAdjust.length > 0 && (
            <div className="mt-5">
              <p className="text-[13px] font-semibold">Precisam de ajustes</p>
              <ul className="mt-1 space-y-1 text-sm text-muted">{needAdjust.map((i) => <li key={i.content_id}>· {i.title}</li>)}</ul>
              <p className="mt-2 text-xs text-muted">As versões corrigidas vão aparecer neste mesmo link.</p>
            </div>
          )}
        </div>
        <Button className="mt-4 h-12 w-full" onClick={() => setSummary(null)}>Voltar aos conteúdos</Button>
      </main>
    );
  }

  if (!item) return <main className="mx-auto min-h-dvh max-w-xl px-5 py-10"><Brand data={data} media={media} /><p className="mt-8 text-sm text-muted">Nenhum conteúdo neste lote.</p></main>;

  const ds = [...item.deliverables].sort((a, b) => order(a.kind) - order(b.kind));
  const main = ds.find((d) => !["cover", "caption"].includes(d.kind));
  const cover = ds.find((d) => d.kind === "cover");
  const caption = ds.find((d) => d.kind === "caption");
  const others = ds.filter((d) => d !== main && d !== cover && d !== caption);
  const decidable = ds.filter((d) => d.version?.decidable);
  const derived = stateOf(item);
  const draft = drafts[item.content_id];
  const choice: Choice | undefined = draft?.choice ?? (derived === "approved" ? "approved" : derived === "rejected" ? "rejected" : undefined);
  const flagged = draft?.flagged ?? decidable.filter((d) => d.version!.status === "rejected").map((d) => d.deliverable_id);
  const comment = draft?.comment ?? decidable.find((d) => d.version!.status === "rejected")?.decision?.comment ?? "";
  const base: Draft = { comment, flagged };
  const patch = (p: Partial<Draft>) => setDrafts((all) => ({ ...all, [item.content_id]: { ...base, ...all[item.content_id], ...p } }));
  const isLast = idx === total - 1;
  const lastRejection = ds.flatMap((d) => d.history.map((h) => ({ ...h, kind: d.kind }))).filter((h) => h.decision === "rejected").sort((a, b) => b.version - a.version)[0];

  return (
    <div className="min-h-dvh bg-bg pb-10">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-4 sm:px-8">
          <Brand data={data} media={media} />
          {data.batch.due_at && (
            <p className="text-sm text-muted">Responda até <strong className="text-accent-ink">{dueLabel(data.batch.due_at)}</strong></p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-accent-ink">Conteúdo {idx + 1} de {total}{item.service ? ` · ${item.service}` : ""}</p>
            <h1 className="mt-1 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{item.title}</h1>
          </div>
          <ol className="flex flex-wrap gap-2" aria-label="Conteúdos do lote">
            {data.items.map((it, n) => {
              const st = stateOf(it);
              const current = n === idx;
              return (
                <li key={it.content_id}>
                  <button type="button" onClick={() => go(n)} disabled={pending} aria-current={current ? "step" : undefined}
                    aria-label={`Conteúdo ${n + 1}: ${it.title}${st === "approved" ? " (aprovado)" : st === "rejected" ? " (ajuste solicitado)" : ""}`}
                    className={cn("flex size-11 items-center justify-center rounded-xl border-2 text-sm font-bold transition-colors",
                      current ? "border-accent bg-accent/10 text-accent-ink" : st === "approved" ? "border-transparent bg-accent text-accent-fg"
                        : st === "rejected" ? "border-[var(--tone-danger-fg)] text-[var(--tone-danger-fg)]" : "border-dashed border-border-strong text-muted hover:text-fg")}>
                    {!current && st === "approved" ? <Check className="size-4" strokeWidth={3} /> : n + 1}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {lastRejection && (
          <p className="mt-4 rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
            Na versão {lastRejection.version} você pediu: “{lastRejection.comment}”. Esta é a versão corrigida.
          </p>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
          {main && (
            <div>
              <SectionLabel>{kindLabel[main.kind] ?? main.title} · {item.format}</SectionLabel>
              <MediaCard d={main} aspect={item.aspect_ratio} media={media} badge={item.format} />
            </div>
          )}
          <div className="space-y-6">
            {cover && (
              <div>
                <SectionLabel>Capa · como aparece no perfil</SectionLabel>
                <div className="max-w-[17rem]"><MediaCard d={cover} aspect="4:5" media={media} /></div>
              </div>
            )}
            {caption && (
              <div>
                <SectionLabel>Legenda</SectionLabel>
                <CaptionCard d={caption} />
              </div>
            )}
            {others.map((d) => (
              <div key={d.deliverable_id}>
                <SectionLabel>{kindLabel[d.kind] ?? d.title}</SectionLabel>
                {d.version?.text && !d.version.assets.length ? <CaptionCard d={d} /> : <div className="max-w-sm"><MediaCard d={d} aspect={item.aspect_ratio} media={media} /></div>}
              </div>
            ))}
          </div>
        </div>

        <section aria-labelledby="decide" className="mt-8 rounded-2xl border border-border bg-surface p-5 sm:p-6">
          {decidable.length === 0 ? (
            <p className="text-sm text-muted">Uma nova versão está sendo preparada pela agência. Ela aparece neste mesmo link.</p>
          ) : (
            <>
              <h2 id="decide" className="text-lg font-bold">Este conteúdo está aprovado?</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-labelledby="decide">
                <button type="button" role="radio" aria-checked={choice === "approved"} onClick={() => patch({ choice: "approved" })}
                  className={cn("flex h-14 items-center justify-center gap-2 rounded-xl border-2 text-[15px] font-bold transition-colors",
                    choice === "approved" ? "border-accent bg-accent text-accent-fg" : "border-accent-ink/70 text-accent-ink hover:bg-accent/10")}>
                  <Check className="size-5" strokeWidth={3} aria-hidden /> Aprovado
                </button>
                <button type="button" role="radio" aria-checked={choice === "rejected"} onClick={() => patch({ choice: "rejected", flagged: flagged.length ? flagged : decidable.map((d) => d.deliverable_id) })}
                  className={cn("flex h-14 items-center justify-center gap-2 rounded-xl border-2 text-[15px] font-bold transition-colors",
                    choice === "rejected" ? "border-[var(--tone-danger-fg)] bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]" : "border-[var(--tone-danger-fg)]/70 text-[var(--tone-danger-fg)] hover:bg-[var(--tone-danger-bg)]")}>
                  <X className="size-5" strokeWidth={3} aria-hidden /> Não aprovado
                </button>
              </div>

              {choice === "rejected" && decidable.length > 1 && (
                <fieldset className="mt-4">
                  <legend className="text-[13px] font-semibold">O que precisa de ajuste?</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {decidable.map((d) => {
                      const on = flagged.includes(d.deliverable_id);
                      return (
                        <label key={d.deliverable_id} className={cn("inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-semibold",
                          on ? "border-[var(--tone-danger-fg)] bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]" : "border-border-strong text-muted")}>
                          <input type="checkbox" className="size-4 accent-[var(--tone-danger-fg)]" checked={on}
                            onChange={() => patch({ flagged: on ? flagged.filter((x) => x !== d.deliverable_id) : [...flagged, d.deliverable_id] })} />
                          {kindLabel[d.kind] ?? d.title}
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-xs text-muted">O que você não marcar é aprovado.</p>
                </fieldset>
              )}

              <label htmlFor="obs" className="mt-4 block text-[13px] font-semibold">
                Observações <span className="font-normal text-muted">({choice === "rejected" ? "obrigatório" : "opcional"})</span>
              </label>
              <Textarea id="obs" rows={3} className="mt-1.5" value={comment} onChange={(e) => patch({ comment: e.target.value })}
                placeholder="Ex.: trocar a foto da capa, ajustar uma palavra na legenda, cortar o início do vídeo..." />
            </>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="tabular text-sm text-muted" aria-live="polite">{answered} de {total} respondidos</p>
            <div className="flex gap-2">
              <Button className="h-11 rounded-full px-5" disabled={pending || idx === 0} onClick={() => go(idx - 1)}><ChevronLeft /> Anterior</Button>
              {isLast ? (
                <Button variant="primary" className="h-11 rounded-full px-6 font-bold" disabled={pending} onClick={finalize}>
                  {pending ? <Loader2 className="animate-spin" /> : <CheckCheck />} Finalizar avaliação
                </Button>
              ) : (
                <Button variant="primary" className="h-11 rounded-full px-6 font-bold" disabled={pending} onClick={() => go(idx + 1)}>
                  {pending && <Loader2 className="animate-spin" />} Próximo conteúdo <ArrowRight />
                </Button>
              )}
            </div>
          </div>
        </section>

        <p className="mt-4 text-center text-xs text-muted">
          Sua resposta vai direto para a equipe da {data.agency.name}. Conteúdos não aprovados voltam para ajuste com as suas observações. Você pode sair e voltar por este mesmo link.
        </p>
      </main>

      <Dialog open={askName} onClose={() => setAskName(false)} size="sm" title="Como podemos te identificar?" description="Seu nome aparece junto das avaliações para a agência.">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); try { localStorage.setItem(nameKey, reviewer); } catch {} setAskName(false); }}>
          <Input autoFocus value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Seu nome" aria-label="Seu nome" autoComplete="name" />
          <div className="flex justify-end gap-2"><Button onClick={() => setAskName(false)}>Pular</Button><Button type="submit" variant="primary">Continuar</Button></div>
        </form>
      </Dialog>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">{children}</h2>;
}

function Brand({ data, media }: { data: PortalData; media: Record<string, string> }) {
  const agencyLogo = data.agency.logo_path ? media[data.agency.logo_path] : null;
  const clientLogo = data.client.logo_path ? media[data.client.logo_path] : null;
  return (
    <div className="flex min-w-0 items-center gap-3 text-sm">
      <span className="flex items-center gap-2 font-bold">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
        {agencyLogo ? <img src={agencyLogo} alt={data.agency.name} className="h-6 w-auto" /> : <span className="flex size-6 items-center justify-center rounded-md text-[11px] font-bold" style={{ background: data.agency.brand_color, color: "#171717" }}>{data.agency.name[0]}</span>}
        <span className="hidden sm:inline">{data.agency.name}</span>
      </span>
      <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
      <span className="flex min-w-0 items-center gap-2 text-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
        {clientLogo && <img src={clientLogo} alt="" className="h-5 w-auto rounded-sm" />}
        <span className="truncate">Aprovação de conteúdo · <strong className="text-fg">{data.client.name}</strong></span>
      </span>
    </div>
  );
}

function CaptionCard({ d }: { d: PortalDeliverable }) {
  const toast = useToast();
  const v = d.version;
  if (!v) return <Pending d={d} />;
  return (
    <div className="max-w-2xl rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{v.text}</p>
      <button type="button" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-fg"
        onClick={() => navigator.clipboard.writeText(v.text ?? "").then(() => toast.success("Texto copiado."))}><Copy className="size-3.5" /> Copiar texto</button>
    </div>
  );
}

function Pending({ d }: { d: PortalDeliverable }) {
  return <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted">{kindLabel[d.kind] ?? d.title}: em produção, ainda não disponível para avaliação.</p>;
}

function MediaCard({ d, aspect, media, badge }: { d: PortalDeliverable; aspect: string | null; media: Record<string, string>; badge?: string }) {
  const [i, setI] = useState(0);
  const assets = d.version?.assets ?? [];
  if (!d.version) return <Pending d={d} />;
  if (!assets.length) return <CaptionCard d={d} />;
  const a = assets[Math.min(i, assets.length - 1)];
  const url = a.provider === "supabase" ? media[a.preview_path ?? a.path ?? ""] : undefined;
  const r = a.width && a.height ? `${a.width} / ${a.height}` : ratio(d.kind === "cover" ? "4:5" : aspect);
  const isVideo = a.mime_type?.startsWith("video/");
  return (
    <div>
      <div className="relative mx-auto flex w-full items-center justify-center overflow-hidden rounded-2xl border border-border bg-black"
        style={{ aspectRatio: r, maxHeight: "72vh", maxWidth: `calc(72vh * (${r}))` }}>
        {badge && isVideo && <span className="absolute left-3 top-3 z-10 rounded-full border border-accent bg-black/60 px-2.5 py-0.5 text-xs font-bold text-accent">{badge}</span>}
        {!url ? (
          <p className="p-6 text-center text-sm text-white/70">Pré-visualização em preparação. A agência foi avisada.</p>
        ) : isVideo ? (
          <video src={url} poster={a.thumbnail_path ? media[a.thumbnail_path] : undefined} controls playsInline preload="metadata" className="size-full object-contain" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- signed private URL
          <img src={url} alt={`${kindLabel[d.kind]} ${i + 1}`} className="size-full object-contain" />
        )}
      </div>
      {assets.length > 1 && (
        <div className="mt-2 flex items-center justify-center gap-3">
          <Button size="icon" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0} aria-label="Slide anterior"><ChevronLeft /></Button>
          <span className="tabular text-sm text-muted" aria-live="polite">{i + 1} / {assets.length}</span>
          <Button size="icon" onClick={() => setI((x) => Math.min(assets.length - 1, x + 1))} disabled={i === assets.length - 1} aria-label="Próximo slide"><ChevronRight /></Button>
        </div>
      )}
    </div>
  );
}
