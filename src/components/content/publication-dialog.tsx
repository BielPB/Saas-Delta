"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, useToast } from "@/components/ui/overlay";
import { channels } from "@/lib/domain";
import { toLocalInput } from "@/lib/format";
import { confirmPublication, schedulePublication } from "@/app/app/conteudos/actions";

/** Schedule (social media confirms the external schedule) or confirm publication. */
export function PublicationDialog({ mode, content, onClose, defaults }: {
  mode: "schedule" | "confirm" | null;
  content: { id: string; label: string; approved: boolean };
  onClose: () => void;
  defaults?: { at?: string | null; channel?: string | null };
}) {
  const [at, setAt] = useState(toLocalInput(defaults?.at ?? new Date().toISOString()));
  const [channel, setChannel] = useState(defaults?.channel ?? "instagram");
  const [url, setUrl] = useState("");
  const [override, setOverride] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  if (!mode) return null;
  const needsOverride = mode === "schedule" && !content.approved;

  const submit = () => start(async () => {
    const r = mode === "schedule"
      ? await schedulePublication(content.id, at, channel, needsOverride ? override : null)
      : await confirmPublication(content.id, at, url || null);
    if (r.ok) { toast.success(r.message ?? "Feito."); onClose(); router.refresh(); } else toast.error(r.error);
  });

  return (
    <Dialog open onClose={onClose} title={mode === "schedule" ? "Registrar agendamento" : "Confirmar publicação"}
      description={content.label}
      footer={<><Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" disabled={pending || (needsOverride && override.trim().length < 3)} onClick={submit}>
          {mode === "schedule" ? "Registrar agendamento" : "Confirmar publicação"}</Button></>}>
      <div className="space-y-4">
        {mode === "schedule" && (
          <p className="text-sm text-muted">Use depois de programar o post na plataforma (Meta Business Suite, mLabs…). O Delta Flow não publica automaticamente nesta versão.</p>
        )}
        <label className="block text-[13px] font-medium">{mode === "schedule" ? "Data e hora agendadas" : "Data e hora efetivas"}
          <Input type="datetime-local" className="mt-1.5" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
        {mode === "schedule" ? (
          <label className="block text-[13px] font-medium">Canal
            <Select className="mt-1.5" value={channel ?? ""} onChange={(e) => setChannel(e.target.value)}>
              {Object.entries(channels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </label>
        ) : (
          <label className="block text-[13px] font-medium">Link do conteúdo publicado <span className="font-normal text-muted">(opcional)</span>
            <Input type="url" className="mt-1.5" placeholder="https://instagram.com/p/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
        )}
        {needsOverride && (
          <div className="rounded-md border border-[var(--tone-warning-fg)]/30 bg-[var(--tone-warning-bg)] p-3">
            <p className="text-[13px] font-medium text-[var(--tone-warning-fg)]">Conteúdo ainda não aprovado</p>
            <p className="mt-0.5 text-xs text-[var(--tone-warning-fg)]">Agendar sem aprovação é uma exceção auditada e exige permissão específica.</p>
            <Textarea className="mt-2" rows={2} placeholder="Motivo da exceção" value={override} onChange={(e) => setOverride(e.target.value)} aria-label="Motivo da exceção" />
          </div>
        )}
      </div>
    </Dialog>
  );
}
