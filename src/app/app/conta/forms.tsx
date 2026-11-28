"use client";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/overlay";
import { changePassword, savePrefs, saveProfile, savePushSubscription } from "./actions";

export function ProfileForm({ name }: { name: string }) {
  const [v, setV] = useState(name);
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveProfile(v); if (r.ok) toast.success(r.message ?? "Salvo."); else toast.error(r.error); }); }}>
      <label className="min-w-0 flex-[1_1_14rem] text-sm font-medium">Como você quer ser chamado?
        <Input className="mt-1" value={v} onChange={(e) => setV(e.target.value)} maxLength={120} required autoComplete="nickname" />
      </label>
      <Button type="submit" variant="primary" disabled={pending || !v.trim() || v.trim() === name}>Salvar</Button>
    </form>
  );
}

const labels: Record<string, string> = { tasks: "Tarefas (atribuída, liberada, prazo, atraso)", approvals: "Aprovações (aprovado, reprovado, ajuste)", publications: "Publicações (próxima, atrasada)", files: "Arquivos e versões", system: "Sistema" };

export function NotificationPrefs({ initial }: { initial: Array<{ category: string; in_app: boolean; email: boolean; push: boolean }> }) {
  const [rows, setRows] = useState(Object.keys(labels).map((c) => initial.find((i) => i.category === c) ?? { category: c, in_app: true, email: false, push: false }));
  const [pending, start] = useTransition();
  const toast = useToast();
  const set = (c: string, k: "in_app" | "email" | "push", v: boolean) => setRows(rows.map((r) => (r.category === c ? { ...r, [k]: v } : r)));
  return (
    <div>
      <table className="w-full text-[13px]">
        <thead><tr className="text-xs text-muted"><th className="px-4 py-2 text-left font-medium">Categoria</th><th className="px-2 font-medium">No app</th><th className="px-2 font-medium">E-mail</th><th className="px-2 font-medium">Push</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.category} className="border-t border-border">
              <td className="px-4 py-2">{labels[r.category]}</td>
              {(["in_app", "email", "push"] as const).map((k) => (
                <td key={k} className="px-2 text-center"><input type="checkbox" className="size-4 accent-[var(--fg)]" aria-label={`${labels[r.category]} — ${k}`} checked={r[k]} onChange={(e) => set(r.category, k, e.target.checked)} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-border px-4 py-3"><Button size="sm" variant="primary" disabled={pending} onClick={() => start(async () => { const r = await savePrefs(rows); if (r.ok) toast.success(r.message ?? "Salvo."); else toast.error(r.error); })}>Salvar preferências</Button></div>
    </div>
  );
}

export function PasswordForm() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await changePassword(cur, next); if (r.ok) { toast.success(r.message ?? "Alterada."); setCur(""); setNext(""); } else toast.error(r.error); }); }}>
      <Input type="password" autoComplete="current-password" placeholder="Senha atual" aria-label="Senha atual" value={cur} onChange={(e) => setCur(e.target.value)} />
      <Input type="password" autoComplete="new-password" placeholder="Nova senha (mín. 8)" aria-label="Nova senha" value={next} onChange={(e) => setNext(e.target.value)} />
      <Button type="submit" disabled={pending || !cur || next.length < 8}>Alterar senha</Button>
    </form>
  );
}

function b64ToBytes(s: string) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Web Push via the PWA service worker. Requires NEXT_PUBLIC_VAPID_PUBLIC_KEY; delivery is done by the worker. */
export function PushToggle() {
  const [state, setState] = useState<"unsupported" | "off" | "on" | "denied" | "unconfigured">("off");
  const [pending, start] = useTransition();
  const toast = useToast();
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  useEffect(() => {
    // Async detection: state is set from the browser APIs' promise callbacks.
    let alive = true;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported" as const;
      if (!vapid) return "unconfigured" as const;
      if (Notification.permission === "denied") return "denied" as const;
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      return sub ? ("on" as const) : ("off" as const);
    })().then((s) => { if (alive) setState(s); });
    return () => { alive = false; };
  }, [vapid]);
  const toggle = () => start(async () => {
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
    if (state === "on") {
      await (await reg.pushManager.getSubscription())?.unsubscribe();
      await savePushSubscription(null); setState("off"); return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { setState("denied"); return; }
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapid!) });
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    const r = await savePushSubscription(json);
    if (r.ok) { setState("on"); toast.success(r.message ?? "Ativado."); } else toast.error(r.error);
  });
  const text = { unsupported: "Este navegador não suporta notificações push.", unconfigured: "Push ainda não configurado no servidor (chaves VAPID).", denied: "Notificações bloqueadas nas configurações do navegador.", on: "Push ativo neste dispositivo.", off: "Receba avisos mesmo com a aba fechada (instale o app na tela inicial no iPhone)." }[state];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
      <span className="text-muted">{text}</span>
      {(state === "on" || state === "off") && <Button size="sm" disabled={pending} onClick={toggle}>{state === "on" ? "Desativar push" : "Ativar push"}</Button>}
    </div>
  );
}
