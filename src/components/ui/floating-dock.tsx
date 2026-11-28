"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import "./floating-dock.css";

export type DockItem = {
  label: string;
  icon: ReactNode;
  active?: boolean;
} & ({ href: string } | { open: () => void });

export function FloatingDock({ items }: { items: DockItem[] }) {
  const [highlight, setHighlight] = useState<number | null>(null);
  return <nav className="delta-dock" aria-label="Navegação principal">
    <ul>
      {items.map((item, i) => {
        const distance = highlight === null ? Infinity : Math.abs(highlight - i);
        const face = <><span className="dock-disc">{item.icon}</span><span className="dock-label" aria-hidden>{item.label}</span></>;
        return <li key={item.label} data-zoom={distance === 0 ? "selected" : distance === 1 ? "near" : undefined}
          onPointerEnter={e => { if (e.pointerType === "mouse") setHighlight(i); }} onPointerLeave={() => setHighlight(null)}>
          {"href" in item
            ? <Link href={item.href} aria-label={item.label} aria-current={item.active ? "page" : undefined}>{face}</Link>
            : <button type="button" aria-label={item.label} aria-haspopup="dialog" data-active={item.active} onClick={item.open}>{face}</button>}
        </li>;
      })}
    </ul>
  </nav>;
}
