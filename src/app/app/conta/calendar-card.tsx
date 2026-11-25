"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarDays, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, useToast } from "@/components/ui/overlay";
import { relative } from "@/lib/format";
import { disconnectCalendar, syncMyCalendar, updateCalendarSettings } from "./calendar-actions";

type Conn = { google_email: string; status: string; last_error: string | null; share_with_team: boolean; push_tasks: boolean; push_posts: boolean; last_synced_at: string | null };

const notices: Record<string, string> = {
  ok: "Agenda conectada. Seus prazos e publicações já estão indo para o Google Agenda.",
  negado: "Você não autorizou o acesso à agenda.",
  escopo: "Marque a permissão de ver e editar eventos na tela do Google e tente de novo.",
  configuracao: "A integração com o Google ainda não foi configurada no servidor (GOOGLE_CLIENT_ID / SECRET).",
};

export function CalendarCard({ conn, configured, notice }: { conn: Conn | null; configured: boolean; notice: string | null }) {
  const [pending, start] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const r = await fn(); if (r.ok) { if (r.message) toast.success(r.message); router.refresh(); } else toast.error(r.error ?? "Erro.");
  });
  const msg = notice ? notices[notice] ?? "Não foi possível conectar. Tente de novo." : null;

  return (
    <div className="space-y-4">
      {msg && <p className={`rounded-md px-3 py-2 text-[13px] ${notice === "ok" ? "bg-[var(--tone-success-bg)] text-[var(--tone-success-fg)]" : "bg-[var(--tone-warning-bg)] text-[var(--tone-warning-fg)]"}`}>{msg}</p>}
      {!conn ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-md">
            <p className="text-[13px]">Veja sua agenda em <strong className="font-medium">Minhas demandas</strong> e receba no Google Agenda os prazos das suas tarefas e as datas de publicação dos seus posts.</p>
            <p className="mt-1 text-xs text-muted">O Delta Flow só mexe nos eventos que ele mesmo cria. Você pode desconectar quando quiser.</p>
          </div>
          {configured
            ? <a href="/api/calendar/connect" className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3 text-[13px] font-semibold text-accent-fg"><CalendarDays className="size-4" aria-hidden /> Conectar Google Agenda</a>
            : <span className="text-xs text-muted">Aguardando configuração do administrador.</span>}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium">{conn.google_email}</p>
              <p className="text-xs text-muted">
                {conn.status === "error" ? <span className="text-[var(--tone-danger-fg)]">{conn.last_error ?? "Erro na conexão."}</span>
                  : conn.last_synced_at ? `Sincronizada ${relative(conn.last_synced_at)}` : "Ainda não sincronizada"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={pending} onClick={() => run(syncMyCalendar)}>{pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sincronizar agora</Button>
              <Button size="sm" variant="ghost" onClick={() => setLeaving(true)}>Desconectar</Button>
            </div>
          </div>
          <ul className="space-y-2.5 border-t border-border pt-3">
            {([
              ["push_tasks", "Enviar os prazos das minhas tarefas", "Evento de 30 min antes do prazo de cada tarefa atribuída a você."],
              ["push_posts", "Enviar as datas de publicação dos meus posts", "Posts em que você é responsável ou editor."],
              ["share_with_team", "Mostrar minha agenda para a gestão", "Quem gerencia a equipe vê seus compromissos em “Ver como”. Eventos privados aparecem só como “Ocupado”."],
            ] as const).map(([k, label, hint]) => (
              <li key={k}>
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--fg)]" checked={conn[k]} disabled={pending}
                    onChange={(e) => run(() => updateCalendarSettings({ [k]: e.target.checked }))} />
                  <span><span className="block text-[13px] font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <Dialog open={leaving} onClose={() => setLeaving(false)} size="sm" title="Desconectar o Google Agenda?"
        description="O Delta Flow perde o acesso à sua agenda. Seus outros compromissos não são tocados."
        footer={<>
          <Button onClick={() => { setLeaving(false); run(() => disconnectCalendar(false)); }}>Manter os eventos</Button>
          <Button variant="danger" onClick={() => { setLeaving(false); run(() => disconnectCalendar(true)); }}>Remover eventos do Delta Flow</Button>
        </>}>
        <p className="text-sm text-muted">Escolha se os eventos que o Delta Flow criou (tarefas e publicações) ficam na sua agenda ou são apagados.</p>
      </Dialog>
    </div>
  );
}
