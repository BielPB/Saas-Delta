"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import "./floating-dock.css";

export type DockItem = {
  label: string;
  icon: ReactNode;
  active?: boolean;
} & ({ href: string } | { open: () => void });

export function FloatingDock({ items }: { items: DockItem[] }) {
  const [highlight, setHighlight] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const dismiss = (e: PointerEvent) => {
      if (e.target instanceof Node && !nav.current?.contains(e.target)) setExpanded(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setExpanded(false); launcher.current?.focus(); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [expanded]);
  return <nav ref={nav} data-expanded={expanded} className="delta-dock" aria-label="Navegação principal">
    <button ref={launcher} className="dock-launcher" type="button" aria-label={expanded ? "Fechar navegação" : "Abrir navegação"}
      aria-expanded={expanded} aria-controls="delta-dock-items" onClick={() => setExpanded(!expanded)}>
      {expanded ? <X size={22}/> : <Menu size={22}/>}
    </button>
    <ul id="delta-dock-items">
      {items.map((item, i) => {
        const distance = highlight === null ? Infinity : Math.abs(highlight - i);
        const face = <><span className="dock-disc">{item.icon}</span><span className="dock-label" aria-hidden>{item.label}</span></>;
        return <li key={item.label} data-zoom={distance === 0 ? "selected" : distance === 1 ? "near" : undefined}
          onPointerEnter={e => { if (e.pointerType === "mouse") setHighlight(i); }} onPointerLeave={() => setHighlight(null)}>
          {"href" in item
            ? <Link href={item.href} onNavigate={() => setExpanded(false)} aria-label={item.label} aria-current={item.active ? "page" : undefined}>{face}</Link>
            : <button type="button" aria-label={item.label} aria-haspopup="dialog" data-active={item.active} onClick={() => { if (expanded) launcher.current?.focus(); setExpanded(false); item.open(); }}>{face}</button>}
        </li>;
      })}
    </ul>
  </nav>;
}
