import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma, withPrismaRetry } from "./db";
import type { SessionUser } from "@/types";
import { logger } from "@/lib/logger";

export const COOKIE_NAME = "udharbook_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 24) {
    throw new Error("SESSION_SECRET is missing or too short");
  }
  return new TextEncoder().encode(secret);
}

function sessionLogMeta(user: SessionUser) {
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    shopId: user.shopId,
  };
}

export async function createSession(user: SessionUser) {
  let token: string;
  try {
    token = await new SignJWT({
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
  } catch (error) {
    logger.error("session_create_token_failed", {
      ...sessionLogMeta(user),
      error: error instanceof Error ? error.message : "Unknown session token error",
      stack: error instanceof Error ? error.stack : undefined,
      hasSessionSecret: Boolean(process.env.SESSION_SECRET),
      sessionSecretLength: process.env.SESSION_SECRET?.length ?? 0,
    });
    throw error;
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
  logger.info("session_created", {
    ...sessionLogMeta(user),
    maxAge: MAX_AGE,
    secureCookie: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export async function destroySession(reason = "explicit_logout") {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  logger.info("session_destroyed", { reason });
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
  if (!token) {
    logger.warn("session_missing_cookie");
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());
    const userId = payload.id as string | undefined;
    if (!userId) {
      logger.warn("session_decode_missing_user_id");
      await clearSessionIfWritable();
      return null;
    }

    const user = await withPrismaRetry(() => prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        shopId: true,
        disabledAt: true,
        shop: { select: { shopName: true } },
      },
    }), { operation: "session_user_lookup", userId });
    if (!user) {
      logger.warn("session_user_missing", { userId });
      await clearSessionIfWritable();
      return null;
    }
    if (user.disabledAt) {
      logger.warn("session_user_disabled", { userId: user.id, email: user.email, role: user.role });
      await clearSessionIfWritable();
      return null;
    }
    if (!user.shop) {
      logger.error("session_shop_missing", { userId: user.id, email: user.email, role: user.role, shopId: user.shopId });
      await clearSessionIfWritable();
      return null;
    }

    const session = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      shopId: user.shopId,
      shopName: user.shop?.shopName ?? null,
    };
    logger.info("session_validated", sessionLogMeta(session));
    return session;
  } catch (error) {
    logger.warn("session_decode_failed", {
      error: error instanceof Error ? error.message : "Unknown session decode error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    await clearSessionIfWritable();
    return null;
  }
}

export async function login(email: string, password: string): Promise<SessionUser | null> {
  const normalizedEmail = email.toLowerCase();
  logger.info("login_lookup_started", { email: normalizedEmail });
  const user = await withPrismaRetry(() => prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      name: true,
      email: true,
      passwordHash: true,
      role: true,
      shopId: true,
      disabledAt: true,
      tempPasswordExpiresAt: true,
      shop: { select: { id: true, shopName: true } },
    },
  }), { operation: "login_user_lookup", email: normalizedEmail });
  if (!user) {
    logger.warn("login_failed_user_missing", { email: normalizedEmail });
    return null;
  }
  logger.info("login_user_found", { userId: user.id, email: user.email, role: user.role, shopId: user.shopId });
  if (user.disabledAt) {
    logger.warn("login_failed_disabled_user", { userId: user.id, email: user.email, role: user.role });
    return null;
  }
  if (!user.shop) {
    logger.error("login_failed_missing_shop", { userId: user.id, email: user.email, role: user.role, shopId: user.shopId });
    return null;
  }
  logger.info("login_shop_validated", { userId: user.id, shopId: user.shopId, shopName: user.shop.shopName });
  if (user.tempPasswordExpiresAt && user.tempPasswordExpiresAt < new Date()) {
    logger.warn("login_failed_temp_password_expired", { userId: user.id, email: user.email, role: user.role });
    return null;
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    logger.warn("login_failed_invalid_password", { userId: user.id, email: user.email, role: user.role });
    return null;
  }
  logger.info("login_password_validated", { userId: user.id, email: user.email, role: user.role });
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  }).catch((error) => {
    logger.error("login_last_login_update_failed_non_blocking", {
      userId: user.id,
      email: user.email,
      role: user.role,
      error: error instanceof Error ? error.message : "Unknown last login update error",
      stack: error instanceof Error ? error.stack : undefined,
    });
  });
  await prisma.activityLog.create({
    data: {
      action: "user_login",
      userId: user.id,
      shopId: user.shopId,
      details: user.email,
    },
  }).catch((error) => {
    logger.error("login_activity_log_failed", {
      userId: user.id,
      email: user.email,
      role: user.role,
      shopId: user.shopId,
      error: error instanceof Error ? error.message : "Unknown activity log error",
    });
  });
  logger.info("login_success", { userId: user.id, email: user.email, role: user.role, shopId: user.shopId });
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
