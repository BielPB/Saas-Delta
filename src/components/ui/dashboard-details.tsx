"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

export function MetricHeading({ children, detail }: { children: string; detail: string }) {
  return <header className="delta-metric-heading"><h2>{children}</h2>
    <button type="button" data-detail={detail} aria-label={`Detalhes: ${children}`}><Info size={16} /></button>
  </header>;
}

export function DashboardDetails({ children }: { children: ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const id = useId();
  function target(el: EventTarget | null) {
    if (!(el instanceof Element)) return null;
    const control = el.closest<HTMLElement>("button, a");
    if (control) return control.hasAttribute("data-detail") ? control : null;
    return el.closest("section")?.querySelector<HTMLElement>(".delta-metric-heading button") ?? null;
  }

  useLayoutEffect(() => {
    if (!anchor || !tip.current) return;
    const rect = anchor.getBoundingClientRect();
    const box = tip.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(innerWidth - box.width - 8, rect.left + (rect.width - box.width) / 2));
    const top = rect.top >= box.height + 16 ? rect.top - box.height - 8 : Math.min(innerHeight - box.height - 8, rect.bottom + 8);
    Object.assign(tip.current.style, { left: left + "px", top: Math.max(8, top) + "px" });
    anchor.setAttribute("aria-describedby", id);
    return () => anchor.removeAttribute("aria-describedby");
  }, [anchor, id]);

  useEffect(() => {
    if (!anchor) return;
    const close = () => setAnchor(null);
    const outside = (event: PointerEvent) => { if (!anchor.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [anchor]);

  return <div className="delta-bento-grid"
    onPointerOver={e => { if (e.pointerType === "mouse") setAnchor(target(e.target)); }}
    onPointerLeave={e => { if (e.pointerType === "mouse") setAnchor(null); }}
    onFocus={e => { if (e.target.matches(":focus-visible")) setAnchor(target(e.target)); }}
    onBlur={() => setAnchor(null)}
    onClick={e => { const el = target(e.target); if (el) setAnchor(el); }}>
    {children}
    {anchor && createPortal(<div id={id} ref={tip} role="tooltip" className="delta-metric-tip">{anchor.dataset.detail}</div>, document.body)}
  </div>;
}
