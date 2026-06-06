import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "./db";
import type { SessionUser } from "@/types";

export const COOKIE_NAME = "udharbook_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 24) {
    throw new Error("SESSION_SECRET is missing or too short");
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    shopId: user.shopId,
    shopName: user.shopName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

async function clearSessionIfWritable() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(COOKIE_NAME);
  } catch {
    // Server components cannot always mutate cookies; route handlers will clear it.
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret());
    const userId = payload.id as string | undefined;
    if (!userId) {
      await clearSessionIfWritable();
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { shop: { select: { shopName: true } } },
    });
    if (!user || user.disabledAt) {
      await clearSessionIfWritable();
      return null;
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      shopId: user.shopId,
      shopName: user.shop?.shopName ?? null,
    };
  } catch {
    await clearSessionIfWritable();
    return null;
  }
}

export async function login(email: string, password: string): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { shop: { select: { shopName: true } } },
  });
  if (!user) return null;
  if (user.disabledAt) return null;
  if (user.tempPasswordExpiresAt && user.tempPasswordExpiresAt < new Date()) return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  await prisma.activityLog.create({
    data: {
      action: "user_login",
      userId: user.id,
      shopId: user.shopId,
      details: user.email,
    },
  });
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    shopId: user.shopId,
    shopName: user.shop?.shopName ?? null,
  };
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

function resetTokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return null;

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: resetTokenHash(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  return {
    email: user.email,
    resetUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/reset-password?token=${token}`,
    token,
  };
}

export async function resetPassword(token: string, password: string) {
  const tokenHash = resetTokenHash(token);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) return false;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await hashPassword(password) },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);

  return true;
}
