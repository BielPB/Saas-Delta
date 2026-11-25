import { Logo } from "@/components/logo";

/** Shown instead of a fake app when Supabase credentials are missing. */
export function SetupRequired() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
      <Logo />
      <h1 className="mt-8 text-xl font-semibold">Configuração pendente</h1>
      <p className="mt-2 text-sm text-muted">
        O Delta Flow não usa dados simulados. Para iniciar, configure o projeto Supabase e as variáveis de ambiente.
      </p>
      <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm text-muted">
        <li>Copie <code className="font-mono text-fg">.env.example</code> para <code className="font-mono text-fg">.env.local</code>.</li>
        <li>Preencha <code className="font-mono text-fg">NEXT_PUBLIC_SUPABASE_URL</code> e <code className="font-mono text-fg">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.</li>
        <li>Aplique as migrations: <code className="font-mono text-fg">npx supabase db push</code>.</li>
        <li>Reinicie o servidor. O passo a passo completo está em DEPLOYMENT.md.</li>
      </ol>
    </main>
  );
}
