import "server-only";
import { headers } from "next/headers";

const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(u);

/**
 * Public origin of the app, used in links sent outside (approval links,
 * invites, OAuth redirects). Prefers NEXT_PUBLIC_APP_URL, but never returns a
 * localhost value when the request itself came from a real host: a copied
 * .env.local on Vercel would otherwise produce links nobody can open.
 */
export async function appOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host && /^(localhost|127\.0\.0\.1)/.test(host) ? "http" : "https");
  const fromRequest = host ? `${proto}://${host}` : "";
  const env = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  if (env && !(isLocal(env) && fromRequest && !isLocal(fromRequest))) return env;
  return fromRequest || env || "http://localhost:3000";
}

/**
 * Origin the browser is actually on (Vercel forwards it). OAuth redirects must use this one:
 * the state cookie lives on this host, so the callback has to come back here.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return appOrigin();
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
