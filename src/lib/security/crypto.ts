import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { config } from "@/src/lib/config";

/** AES-256-GCM. Output: base64(iv).base64(tag).base64(ciphertext). */
export function encryptSecret(plaintext: string): string {
  const key = Buffer.from(config().ENCRYPTION_KEY, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(payload: string): string {
  const key = Buffer.from(config().ENCRYPTION_KEY, "hex");
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !data) throw new Error("Malformed encrypted credential");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function hmac(value: string): string {
  return createHmac("sha256", config().AUTH_SECRET).update(value).digest("base64url");
}

/** `value.signature`, verifiable with {@link verifySigned}. */
export function sign(value: string): string {
  return `${value}.${hmac(value)}`;
}

export function verifySigned(token: string | undefined | null): string | null {
  if (!token) return null;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const value = token.slice(0, idx);
  const sig = Buffer.from(token.slice(idx + 1));
  const expected = Buffer.from(hmac(value));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  return value;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
