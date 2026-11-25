import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Delta logo (public/brand/logo.png: símbolo + palavra "delta").
 * `compact` mostra só o símbolo, que ocupa ~32% da largura da imagem.
 * No tema claro a logo vira carbono (brightness-0), porque o verde-limão some no fundo branco.
 */
export function Logo({ compact, className }: { compact?: boolean; className?: string }) {
  const img = (
    <Image
      src="/brand/logo.png"
      alt="Delta"
      width={800}
      height={224}
      priority
      className="h-7 w-auto max-w-none brightness-0 dark:brightness-100"
    />
  );
  return (
    <span className={cn("inline-flex items-center", className)}>
      {compact ? <span className="block h-7 w-8 shrink-0 overflow-hidden">{img}</span> : img}
    </span>
  );
}
