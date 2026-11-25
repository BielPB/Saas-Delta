import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/env";

/** AES-256-GCM. Key: 32 random bytes, base64 (DRIVE_TOKEN_ENCRYPTION_KEY). Format: v1.<iv>.<tag>.<ciphertext> */
function key() {
  const raw = Buffer.from(serverEnv().driveTokenKey, "base64");
  if (raw.length !== 32) throw new Error("DRIVE_TOKEN_ENCRYPTION_KEY deve ter 32 bytes em base64.");
  return raw;
}

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decrypt(payload: string) {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Formato de credencial inválido.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
