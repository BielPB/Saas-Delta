"use client";

import { useState } from "react";
import Link from "next/link";
import { Dialog } from "@/components/ui/overlay";

export function AgendaEvent({ title, day, time, description, location, target }: {
  title: string; day: string; time: string; description?: string; location?: string;
  target: { href: string; internal: boolean } | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}
        className="block w-full rounded-md border-l-2 border-border-strong bg-surface-2 px-1.5 py-1 text-left text-[11.5px] leading-tight hover:bg-surface-3">
        <span className="tabular block text-muted">{time}</span>{title}
      </button>
      {open && (
        <Dialog open title={title} size="sm" description={`${day} · ${time}`} onClose={() => setOpen(false)}>
          <p className="whitespace-pre-wrap text-sm">{description?.trim() || "Este compromisso não tem descrição."}</p>
          {location && <p className="mt-3 text-sm">Local: {location}</p>}
          {target && <div className="mt-4 text-sm font-medium text-accent-ink">
            {target.internal ? <Link href={target.href}>Ver no Delta Flow</Link>
              : <a href={target.href} target="_blank" rel="noreferrer noopener">Abrir no Google Agenda</a>}
          </div>}
        </Dialog>
      )}
    </li>
  );
}
