#!/usr/bin/env node
// Delta Flow worker — runs outside Vercel (Render background worker, Fly, a VM).
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, EMAIL_FROM,
//      NEXT_PUBLIC_APP_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, DRIVE_TOKEN_ENCRYPTION_KEY
// Requires ffmpeg/ffprobe on PATH for previews.
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { makePreview, probe } from "./transcode.mjs";

const env = process.env;
const BUCKET = "workspace-files";
const HANDLED = ["send_email", "generate_preview"];
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ------------------------------------------------------------- crypto -- */
const key = () => Buffer.from(env.DRIVE_TOKEN_ENCRYPTION_KEY ?? "", "base64");
function decrypt(p) {
  const [, iv, tag, data] = p.split(".");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
function encrypt(s) {
  const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(s, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

async function driveToken(workspaceId) {
  const { data: conn } = await sb.from("drive_connections").select("id").eq("workspace_id", workspaceId).eq("status", "active").limit(1).maybeSingle();
  if (!conn) throw new Error("no active Drive connection");
  const { data: cred } = await sb.from("drive_credentials").select("*").eq("connection_id", conn.id).single();
  if (cred.access_token_encrypted && new Date(cred.access_token_expires_at).getTime() > Date.now() + 60_000) return decrypt(cred.access_token_encrypted);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: decrypt(cred.refresh_token_encrypted), grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error(`drive refresh ${res.status}`);
  const t = await res.json();
  await sb.from("drive_credentials").update({ access_token_encrypted: encrypt(t.access_token), access_token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString() }).eq("connection_id", conn.id);
  return t.access_token;
}

/* ------------------------------------------------------------ handlers -- */
async function sendEmail(job) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
  const { user_id, title, body, link } = job.payload;
  const { data: u, error } = await sb.auth.admin.getUserById(user_id);
  if (error || !u?.user?.email) throw new Error("recipient not found");
  const url = `${env.NEXT_PUBLIC_APP_URL ?? ""}${link?.startsWith("/app") ? link : "/app"}`;
  // The logo is only referenced when the app URL is public (an email client cannot load localhost).
  const logo = /^https:\/\//.test(env.NEXT_PUBLIC_APP_URL ?? "")
    ? `<div style="background:#171717;padding:16px 24px"><img src="${env.NEXT_PUBLIC_APP_URL}/brand/logo.png" alt="Delta" height="26" style="display:block;height:26px;width:auto"></div>`
    : `<div style="background:#171717;padding:16px 24px;color:#C6FF34;font-weight:800;font-size:18px;letter-spacing:.5px">delta</div>`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": job.idempotency_key },
    body: JSON.stringify({
      from: env.EMAIL_FROM ?? "Delta Flow <no-reply@deltaflow.com.br>", to: [u.user.email], subject: title,
      html: `<div style="background:#f4f4f5;padding:24px 12px;font-family:system-ui,-apple-system,Segoe UI,sans-serif"><div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7">${logo}<div style="padding:24px"><p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#171717">${esc(title)}</p>${body ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#52525b">${esc(body)}</p>` : ""}<a href="${esc(url)}" style="display:inline-block;background:#C6FF34;color:#171717;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px">Abrir no Delta Flow</a></div><p style="margin:0;padding:14px 24px;border-top:1px solid #e4e4e7;font-size:12px;color:#8a8a93">Você recebe este e-mail porque ativou as notificações por e-mail. Ajuste isso em Minha conta.</p></div></div>`,
      text: `${title}\n\n${body ?? ""}\n\n${url}`,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}

async function generatePreview(job) {
  const { asset_id } = job.payload;
  const { data: a, error } = await sb.from("file_assets").select("*").eq("id", asset_id).single();
  if (error || !a) throw new Error("asset not found");
  const dir = await mkdtemp(join(tmpdir(), "df-"));
  try {
    const src = join(dir, "source");
    if (a.provider === "drive") {
      const token = await driveToken(a.workspace_id);
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(a.drive_file_id)}?alt=media&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` } });
      if (res.status === 404) { await sb.from("file_assets").update({ status: "missing" }).eq("id", a.id); return; }
      if (!res.ok || !res.body) throw new Error(`drive download ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(src));
    } else if (a.provider === "supabase") {
      const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(a.storage_path, 3600);
      const res = await fetch(signed.signedUrl);
      if (!res.ok || !res.body) throw new Error(`storage download ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(src));
    } else return;

    const mp4 = join(dir, "preview.mp4"); const jpg = join(dir, "poster.jpg");
    await makePreview(src, mp4, jpg);
    const meta = await probe(mp4);
    const base = `${a.workspace_id}/${a.client_id ?? "_shared"}/${a.id}`;
    const up = async (path, file, type) => {
      const { error: e } = await sb.storage.from(BUCKET).upload(path, await readFile(file), { contentType: type, upsert: true });
      if (e) throw e;
    };
    await up(`${base}/preview.mp4`, mp4, "video/mp4");
    await up(`${base}/poster.jpg`, jpg, "image/jpeg");
    await sb.from("file_assets").update({
      preview_path: `${base}/preview.mp4`, thumbnail_path: `${base}/poster.jpg`, status: "available",
      width: a.width ?? meta.width, height: a.height ?? meta.height, duration_seconds: a.duration_seconds ?? meta.duration,
    }).eq("id", a.id);
    log("preview ok", a.id, (await stat(mp4)).size, "bytes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const handlers = { send_email: sendEmail, generate_preview: generatePreview };

/* -------------------------------------------------------------- loop ---- */
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function tick() {
  await sb.rpc("release_stale_jobs");
  const { data: jobs, error } = await sb.rpc("claim_background_jobs", { p_types: HANDLED, p_limit: 3 });
  if (error) { log("claim error", error.message); return 0; }
  for (const job of jobs ?? []) {
    try {
      await handlers[job.type](job);
      await sb.rpc("finish_background_job", { p_id: job.id, p_ok: true });
      log("done", job.type, job.id);
    } catch (e) {
      await sb.rpc("finish_background_job", { p_id: job.id, p_ok: false, p_error: String(e?.message ?? e) });
      log("failed", job.type, job.id, e?.message);
      if (job.type === "generate_preview" && job.attempts >= job.max_attempts) {
        await sb.from("file_assets").update({ status: "error" }).eq("id", job.payload.asset_id);
      }
    }
  }
  return jobs?.length ?? 0;
}

if (process.argv[1]?.endsWith("index.mjs")) {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error("Missing Supabase env"); process.exit(1); }
  log("worker started", HANDLED.join(","));
  while (!stopping) {
    const n = await tick().catch((e) => { log("tick error", e.message); return 0; });
    if (!n) await new Promise((r) => setTimeout(r, 5000));
  }
  log("worker stopped");
}
