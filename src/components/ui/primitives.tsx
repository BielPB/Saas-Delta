import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/domain";
import { initials } from "@/lib/format";

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span
      className={cn("inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-[11.5px] font-medium leading-none whitespace-nowrap", className)}
      style={{ background: `var(--tone-${tone}-bg)`, color: `var(--tone-${tone}-fg)` }}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function Panel({ children, className, title, actions, padded = true }: {
  children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; padded?: boolean;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-surface", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
          {title && <h2 className="min-w-0 text-[13px] font-semibold text-fg">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-4" : undefined}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 truncate text-xs text-muted">{eyebrow}</div>}
        {/* Wraps instead of cutting long names on narrow screens. */}
        <h1 className="break-words text-xl font-bold tracking-tight text-fg sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, compact }: {
  icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "py-8" : "py-14")}>
      {icon && <div className="mb-3 flex size-10 items-center justify-center rounded-md border border-border bg-surface-2 text-muted [&_svg]:size-5">{icon}</div>}
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} aria-hidden />;
}

export function Avatar({ name, src, size = 24, className }: { name?: string | null; src?: string | null; size?: number; className?: string }) {
  return (
    <span
      title={name ?? undefined}
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-3 font-medium text-muted", className)}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38) }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatars are small external images
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function Progress({ value, max, className, label }: { value: number; max: number; className?: string; label?: string }) {
  const p = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const reached = max > 0 && value >= max;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div className={cn("h-full rounded-full transition-[width]", reached ? "bg-accent" : "bg-fg/70")} style={{ width: `${p}%` }} />
      </div>
      <span className="tabular w-16 text-right text-xs text-muted">{value}/{max || "—"}</span>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface-2 px-1 font-mono text-[10.5px] text-muted">{children}</kbd>;
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: Tone }) {
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {tone && <span className="size-1.5 rounded-full" style={{ background: `var(--tone-${tone}-fg)` }} aria-hidden />}
        {label}
      </div>
      <div className="tabular mt-1 text-xl font-semibold tracking-tight text-fg sm:text-2xl">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </>
  );
  const cls = "block min-w-0 rounded-lg border border-border bg-surface px-3 py-3 sm:px-4";
  return href ? (
    <a href={href} className={cn(cls, "transition-colors hover:border-border-strong hover:bg-surface-2")}>{inner}</a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm [&_td]:border-t [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted [&_tbody_tr:hover]:bg-surface-2/60">
        {children}
      </table>
    </div>
  );
}
