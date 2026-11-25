import Link from "next/link";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-6 text-center">
      <Logo compact />
      <h1 className="mt-6 text-lg font-semibold">Página não encontrada</h1>
      <p className="mt-2 text-sm text-muted">O endereço não existe ou você não tem acesso a este conteúdo neste workspace.</p>
      <Link href="/app" className="mt-5 inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg">Voltar ao início</Link>
    </main>
  );
}
