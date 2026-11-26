"use client";
import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode,
} from "react";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/* ----------------------------------------------------------------------------
 * Dialog — native <dialog>: focus trap, Esc and inert background for free.
 * -------------------------------------------------------------------------- */
export function Dialog({
  open, onClose, title, description, children, footer, size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-lg border border-border bg-surface p-0 text-fg shadow-pop backdrop:backdrop-blur-[1px]",
        size === "sm" && "max-w-sm", size === "md" && "max-w-lg", size === "lg" && "max-w-2xl",
        // Phones: bottom sheet (full width, anchored to the bottom, thumb-reachable buttons).
        "max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0",
      )}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
            <div className="min-w-0">
              <h2 id={titleId} className="text-[15px] font-semibold">{title}</h2>
              {description && <p className="mt-1 break-words text-sm text-muted">{description}</p>}
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fechar"><X /></Button>
          </div>
          {children && <div className={cn("overflow-y-auto px-4 py-4 sm:px-5", !footer && "max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]")}>{children}</div>}
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3 max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5 max-sm:[&>*]:flex-1">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

/* ----------------------------------------------------------------------------
 * Toasts — every action gets visible feedback (briefing §6).
 * -------------------------------------------------------------------------- */
type ToastKind = "success" | "error" | "info";
interface ToastItem { id: number; kind: ToastKind; message: string }
const ToastCtx = createContext<(kind: ToastKind, message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, kind, message }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
           role="region" aria-label="Notificações da ação">
        {items.map((t) => (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"}
               className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-md border border-border bg-surface px-3.5 py-2.5 text-sm shadow-pop">
            {t.kind === "success" && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--tone-success-fg)]" aria-hidden />}
            {t.kind === "error" && <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--tone-danger-fg)]" aria-hidden />}
            {t.kind === "info" && <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />}
            <span className="flex-1">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return {
    success: (m: string) => push("success", m),
    error: (m: string) => push("error", m),
    info: (m: string) => push("info", m),
  };
}

/* ----------------------------------------------------------------------------
 * Menu — small disclosure menu with outside-click / Esc handling.
 * -------------------------------------------------------------------------- */
export function Menu({ trigger, children, align = "end", label }: {
  trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu"; "aria-label"?: string }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "menu", "aria-label": label })}
      {open && (
        <div role="menu" className={cn("absolute z-50 mt-1 min-w-48 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-surface p-1 shadow-pop",
          align === "end" ? "right-0" : "left-0")}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onSelect, danger, disabled }: { children: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button role="menuitem" type="button" disabled={disabled} onClick={onSelect}
      className={cn("flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm hover:bg-surface-2 pointer-coarse:py-2.5 disabled:opacity-50 [&_svg]:size-4 [&_svg]:text-muted",
        danger && "text-[var(--tone-danger-fg)] [&_svg]:text-current")}>
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------------------
 * Tooltip — CSS-only, appears on hover AND keyboard focus.
 * -------------------------------------------------------------------------- */
export function Tooltip({ content, children, side = "top" }: { content: string; children: ReactNode; side?: "top" | "right" | "bottom" }) {
  const id = useId();
  return (
    <span className="group/tt relative inline-flex" aria-describedby={id}>
      {children}
      <span id={id} role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-sm bg-fg px-2 py-1 text-[11.5px] font-medium text-bg opacity-0 transition-opacity delay-300 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100",
          side === "top" && "bottom-full left-1/2 mb-1.5 -translate-x-1/2",
          side === "bottom" && "top-full left-1/2 mt-1.5 -translate-x-1/2",
          side === "right" && "left-full top-1/2 ml-2 -translate-y-1/2",
        )}>
        {content}
      </span>
    </span>
  );
}
