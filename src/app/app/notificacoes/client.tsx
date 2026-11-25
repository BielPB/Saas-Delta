"use client";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markNotificationsRead } from "@/app/app/actions";

export function MarkAllRead() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return <Button size="sm" disabled={pending} onClick={() => start(async () => { await markNotificationsRead("all"); router.refresh(); })}><CheckCheck /> Marcar todas como lidas</Button>;
}

export function NotificationLink({ id, href, unread, children }: { id: string; href: string; unread: boolean; children: ReactNode }) {
  const router = useRouter();
  const [, start] = useTransition();
  const safe = href.startsWith("/app") ? href : "/app";
  return (
    <a href={safe} className="flex items-start gap-3 px-4 py-2.5 hover:bg-surface-2"
      onClick={(e) => { e.preventDefault(); start(async () => { if (unread) await markNotificationsRead([id]); router.push(safe); }); }}>
      {children}
    </a>
  );
}
