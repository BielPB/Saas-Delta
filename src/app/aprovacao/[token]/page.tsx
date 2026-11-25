import type { Metadata, Viewport } from "next";
import { isConfigured } from "@/lib/env";
import { getPortalSession, portalRpc, signPortalMedia, TOKEN_RE, type PortalData } from "@/lib/portal";
import { PortalApp } from "./portal-app";
import { PortalGate, Unavailable } from "./gate";

export const metadata: Metadata = {
  title: "Aprovação de conteúdos",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};
export const viewport: Viewport = { themeColor: "#171717", width: "device-width", initialScale: 1 };

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isConfigured() || !TOKEN_RE.test(token)) return <Unavailable />;
  const session = await getPortalSession(token);
  if (!session) return <PortalGate token={token} />;

  const { data, error } = await portalRpc().rpc("portal_get", { p_token: token, p_session: session });
  if (error) {
    if (/link_unavailable/.test(error.message)) return <Unavailable />;
    return <PortalGate token={token} />; // session expired → reopen (PIN asked again if needed)
  }
  const portal = data as PortalData;
  const urls = await signPortalMedia(portal);
  const media = Object.fromEntries(urls);
  return <PortalApp token={token} data={portal} media={media} />;
}
