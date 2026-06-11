import crypto from "node:crypto";
import { prisma } from "@/lib/db";

const algorithm = "aes-256-gcm";

function secretKey() {
  const secret = process.env.WHATSAPP_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("WHATSAPP_SESSION_SECRET must be set to at least 32 characters before connecting WhatsApp.");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSessionValue(value: unknown) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, secretKey(), iv);
  const plaintext = JSON.stringify(value);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptSessionValue<T>(value: string): T {
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Invalid WhatsApp session payload.");
  const decipher = crypto.createDecipheriv(algorithm, secretKey(), Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64")), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

export async function readSessionSecret<T>(shopId: string, key: string) {
  const row = await prisma.whatsAppSessionSecret.findUnique({
    where: { shopId_key: { shopId, key } },
    select: { value: true },
  });
  return row ? decryptSessionValue<T>(row.value) : null;
}

export async function writeSessionSecret(shopId: string, key: string, value: unknown) {
  await prisma.whatsAppSessionSecret.upsert({
    where: { shopId_key: { shopId, key } },
    update: { value: encryptSessionValue(value) },
    create: { shopId, key, value: encryptSessionValue(value) },
  });
}

export async function deleteSessionSecret(shopId: string, key: string) {
  await prisma.whatsAppSessionSecret.deleteMany({ where: { shopId, key } });
}

export async function clearSessionSecrets(shopId: string) {
  await prisma.whatsAppSessionSecret.deleteMany({ where: { shopId } });
}
