import { z } from "zod";

/**
 * Public env is inlined at build time; server env is validated lazily so a
 * missing optional integration (Drive, Resend) never breaks the core app.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export function publicEnv() {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
  if (!parsed.success) {
    throw new Error(
      "Configuração ausente: defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (veja .env.example).",
    );
  }
  return parsed.data;
}

export function isConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function serverEnv() {
  return {
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    driveTokenKey: process.env.DRIVE_TOKEN_ENCRYPTION_KEY ?? "",
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    emailFrom: process.env.EMAIL_FROM ?? "Delta Flow <no-reply@deltaflow.com.br>",
    cronSecret: process.env.CRON_SECRET ?? "",
  };
}

export const integrations = {
  drive: () => {
    const e = serverEnv();
    return Boolean(e.googleClientId && e.googleClientSecret && e.driveTokenKey && e.serviceRoleKey);
  },
  email: () => Boolean(serverEnv().resendApiKey && serverEnv().serviceRoleKey),
  /** Google Agenda uses the same Google OAuth client and token key as Drive. */
  calendar: () => {
    const e = serverEnv();
    return Boolean(e.googleClientId && e.googleClientSecret && e.driveTokenKey && e.serviceRoleKey);
  },
};
