import type { Metadata } from "next";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { NotificationPrefs, PasswordForm, ProfileForm, PushToggle } from "./forms";

export const metadata: Metadata = { title: "Minha conta" };

export default async function AccountPage() {
  const ctx = await getContext();
  const sb = await createClient();
  const { data: prefs } = await sb.from("notification_preferences").select("category, in_app, email, push").eq("user_id", ctx.user.id).eq("workspace_id", ctx.workspace.id);
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Minha conta" description={ctx.profile.email ?? undefined} />
      <Panel title="Perfil"><ProfileForm name={ctx.profile.full_name} /></Panel>
      <Panel title="Notificações" padded={false}>
        <NotificationPrefs initial={(prefs ?? []) as Array<{ category: string; in_app: boolean; email: boolean; push: boolean }>} />
        <div className="border-t border-border px-4 py-3"><PushToggle /></div>
      </Panel>
      <Panel title="Senha"><PasswordForm /></Panel>
      <Panel title="Seus dados">
        <p className="text-[13px] text-muted">Para exportar ou excluir seus dados pessoais (LGPD), fale com o proprietário do workspace. Solicitações são registradas na auditoria. Conteúdos produzidos pertencem à agência.</p>
      </Panel>
    </div>
  );
}
