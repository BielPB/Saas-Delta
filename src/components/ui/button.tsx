import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md" | "icon" | "icon-sm";

const base =
  "df-button df-press inline-flex items-center justify-center gap-1.5 max-w-full wrap-anywhere whitespace-normal rounded-md text-sm font-medium transition-colors " +
  "disabled:pointer-events-none disabled:opacity-50 select-none [&_svg]:size-4 [&_svg]:shrink-0";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-95 active:brightness-90",
  secondary: "border border-border bg-surface text-fg hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-fg",
  danger: "border border-[var(--tone-danger-fg)]/30 bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)] hover:brightness-95",
  subtle: "bg-surface-2 text-fg hover:bg-surface-3",
};
// Touch screens get taller targets (finger, not mouse pointer).
const sizes: Record<Size, string> = {
  sm: "min-h-8 py-1 px-2.5 text-[13px] pointer-coarse:min-h-9",
  md: "min-h-9 py-1 px-3.5 pointer-coarse:min-h-10",
  icon: "size-9 pointer-coarse:size-10",
  "icon-sm": "size-8 pointer-coarse:size-9",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...props} />;
});

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
