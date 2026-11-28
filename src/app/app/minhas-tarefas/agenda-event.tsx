"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Dialog } from "@/components/ui/overlay";

export function AgendaEvent({ title, day, time, description, location, target }: {
  title: string; day: string; time: string; description?: string; location?: string;
  target: { href: string; internal: boolean } | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}
        className="flex min-h-20 w-full items-center justify-between gap-3 py-4 text-left hover:text-neutral-600 focus-visible:-outline-offset-2">
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="mt-1 block text-xs tabular-nums text-neutral-600">{time}</span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-neutral-400" aria-hidden />
      </button>
      {open && (
        <Dialog open title={title} size="sm" description={`${day} · ${time}`} onClose={() => setOpen(false)}>
          <p className="whitespace-pre-wrap text-sm text-fg">{description?.trim() || "Este compromisso não tem descrição."}</p>
          {location && <p className="mt-3 text-sm text-fg">Local: {location}</p>}
          {target && <div className="mt-4 text-sm font-medium text-accent-ink">
            {target.internal ? <Link href={target.href}>Ver no Delta Flow</Link>
              : <a href={target.href} target="_blank" rel="noreferrer noopener">Abrir no Google Agenda</a>}
          </div>}
        </Dialog>
      )}
    </li>
  );
}
