import { Logo } from "@/components/logo";
import { isConfigured } from "@/lib/env";
import { SetupRequired } from "@/components/setup-required";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  if (!isConfigured()) return <SetupRequired />;
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,520px)]">
      <aside className="relative hidden overflow-hidden bg-carbon p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <span className="inline-flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
            <rect width="24" height="24" rx="6" fill="#fff" />
            <path d="M12 5.5 18.5 17.5H5.5Z" fill="#171717" />
            <path d="M7.4 14.3h9.2" stroke="#C6FF34" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span className="text-[15px] font-semibold">Delta Flow</span>
        </span>
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
