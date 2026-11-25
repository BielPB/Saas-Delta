"use client";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-sm flex-col items-center justify-center px-6 text-center">
      <h1 className="text-lg font-semibold">Algo deu errado ao carregar esta tela</h1>
      <p className="mt-2 text-sm text-muted">Nenhum dado foi perdido. Tente novamente; se persistir, verifique sua conexão.</p>
      <Button variant="primary" className="mt-5" onClick={reset}>Tentar novamente</Button>
    </main>
  );
}
