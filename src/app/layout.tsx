import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ToastProvider } from "@/components/ui/overlay";
import "./globals.css";

// Every screen depends on the session, permissions or a portal token: never prerender.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Delta Flow", template: "%s · Delta Flow" },
  description: "Da criação à publicação, tudo em um único fluxo.",
  applicationName: "Delta Flow",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Delta Flow", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0b" },
  ],
  width: "device-width",
  initialScale: 1,
  // Installed app on iPhone (status bar "black-translucent"): draw under the notch and pad with env(safe-area-inset-*).
  viewportFit: "cover",
};

// Applies the saved theme before paint (no flash). Preference only, never data.
const themeScript = `(function(){try{var t=localStorage.getItem('df-theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh overflow-x-clip">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
