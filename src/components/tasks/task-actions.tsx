"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Loader2, MoreHorizontal, Play, RotateCcw, Send, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, Menu, MenuItem, useToast } from "@/components/ui/overlay";
import { Textarea } from "@/components/ui/form";
import type { TaskKind, TaskStatus } from "@/lib/domain";
import { cancelTask, completeTask, reopenTask, sendTaskToReview, startTask } from "@/app/app/tarefas/actions";

export function TaskQuickActions({ task, canManage }: {
  task: { id: string; status: TaskStatus; kind: TaskKind; hasDeliverable: boolean; contentId: string | null };
  canManage: boolean;
}) {
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<null | "reopen" | "cancel">(null);
  const [reason, setReason] = useState("");
  const toast = useToast();
  const router = useRouter();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(r.message ?? "Feito."); router.refresh(); }
      else toast.error(r.error ?? "Não foi possível concluir.");
    });

  const open = ["pending", "reopened", "in_progress", "in_review"].includes(task.status);
  const primary =
    task.status === "pending" || task.status === "reopened"
      ? { label: "Iniciar", icon: <Play />, fn: () => startTask(task.id) }
      : task.status === "in_progress" || (task.status === "in_review" && canManage)
        ? { label: "Concluir", icon: <Check />, fn: () => completeTask(task.id) }
        : null;

  return (
    <div className="flex shrink-0 items-center gap-1">
      {task.status === "in_progress" && task.hasDeliverable && task.contentId && (
        <Button size="sm" variant="ghost" onClick={() => router.push(`/app/tarefas/${task.id}#entrega`)} aria-label="Enviar entrega"><Upload /></Button>
      )}
      {primary && (
        <Button size="sm" variant={primary.label === "Concluir" ? "primary" : "secondary"} disabled={pending} onClick={() => run(primary.fn)}>
          {pending ? <Loader2 className="animate-spin" /> : primary.icon}<span className="hidden sm:inline">{primary.label}</span>
        </Button>
      )}
      <Menu label="Mais ações" trigger={(p) => <Button size="icon-sm" variant="ghost" {...p}><MoreHorizontal /></Button>}>
        {(close) => (
          <>
            {task.status === "in_progress" && task.kind !== "review" && (
              <MenuItem onSelect={() => { close(); run(() => sendTaskToReview(task.id)); }}><Send /> Enviar para revisão</MenuItem>
            )}
            {canManage && ["done", "in_review", "cancelled"].includes(task.status) && (
              <MenuItem onSelect={() => { close(); setDialog("reopen"); }}><RotateCcw /> Reabrir com motivo</MenuItem>
            )}
            {canManage && open && (
              <MenuItem danger onSelect={() => { close(); setDialog("cancel"); }}><XCircle /> Cancelar tarefa</MenuItem>
            )}
            <MenuItem onSelect={() => { close(); router.push(`/app/tarefas/${task.id}`); }}>Abrir detalhes</MenuItem>
          </>
        )}
      </Menu>
      <Dialog open={dialog !== null} onClose={() => setDialog(null)} size="sm"
        title={dialog === "reopen" ? "Reabrir tarefa" : "Cancelar tarefa"}
        description={dialog === "reopen" ? "O responsável será notificado com o motivo." : "Tarefas dependentes deixam de ficar bloqueadas por esta."}
        footer={<>
          <Button onClick={() => setDialog(null)}>Voltar</Button>
          <Button variant={dialog === "cancel" ? "danger" : "primary"} disabled={pending || (dialog === "reopen" && reason.trim().length < 3)}
            onClick={() => { const d = dialog; setDialog(null); run(() => (d === "reopen" ? reopenTask(task.id, reason) : cancelTask(task.id, reason))); setReason(""); }}>
            Confirmar
          </Button>
        </>}>
        <label className="mb-1.5 block text-[13px] font-medium" htmlFor={`reason-${task.id}`}>Motivo</label>
        <Textarea id={`reason-${task.id}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
      </Dialog>
    </div>
  );
}
