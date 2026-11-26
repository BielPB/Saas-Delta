import { Logo } from "@/components/logo";
import { isConfigured } from "@/lib/env";
import { SetupRequired } from "@/components/setup-required";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  if (!isConfigured()) return <SetupRequired />;
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,520px)]">
      <aside className="relative hidden overflow-hidden bg-carbon p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <Logo onDark />
        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight">
            Da criação à publicação,<br />tudo em um único <span className="text-lime">fluxo</span>.
          </p>
          <ul className="mt-8 space-y-2 text-sm text-white/65">
            <li>Pipeline com dependências reais entre captação, edição, capa e legenda.</li>
            <li>Aprovação do cliente por link seguro, item a item, sem cadastro.</li>
            <li>Versionamento completo e ajustes abertos só onde foi reprovado.</li>
          </ul>
        </div>
        <p className="text-xs text-white/40">Marketing Operations SaaS</p>
      </aside>
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mb-8 lg:hidden"><Logo /></div>
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </div>
    </main>
  );
}
