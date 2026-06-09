import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma, withPrismaRetry } from "./db";
import type { SessionUser } from "@/types";
import { logger } from "@/lib/logger";
import { passwordHashDiagnostics, safeAuthRuntimeDiagnostics } from "@/lib/auth-diagnostics";

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

export async function createSession(user: SessionUser, traceId?: string) {
  let token: string;
  try {
    logger.info("auth_trace_session_token_sign_start", {
      traceId,
      ...sessionLogMeta(user),
      diagnostics: safeAuthRuntimeDiagnostics(),
    });
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
      traceId,
      ...sessionLogMeta(user),
      error: error instanceof Error ? error.message : "Unknown session token error",
      stack: error instanceof Error ? error.stack : undefined,
      hasSessionSecret: Boolean(process.env.SESSION_SECRET),
      sessionSecretLength: process.env.SESSION_SECRET?.length ?? 0,
    });
    throw error;
  }

  const cookieStore = await cookies();
  logger.info("auth_trace_session_cookie_write_start", {
    traceId,
    ...sessionLogMeta(user),
    tokenLength: token.length,
    secureCookie: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
  logger.info("session_created", {
    traceId,
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
    logger.info("auth_trace_session_jwt_verified", {
      userId: userId ?? null,
      role: typeof payload.role === "string" ? payload.role : null,
      shopId: typeof payload.shopId === "string" ? payload.shopId : null,
    });
    if (!userId) {
      logger.warn("session_decode_missing_user_id");
      await clearSessionIfWritable();
      return null;
    }

    logger.info("auth_trace_session_user_lookup_start", { userId });
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
    if (!user.shop && user.role !== "SUPER_ADMIN") {
      logger.error("session_shop_missing", { userId: user.id, email: user.email, role: user.role, shopId: user.shopId });
      await clearSessionIfWritable();
      return null;
    }
    if (!user.shop && user.role === "SUPER_ADMIN") {
      logger.warn("session_super_admin_platform_shop_missing_non_blocking", {
        userId: user.id,
        email: user.email,
        role: user.role,
        shopId: user.shopId,
      });
    }

    const session = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      shopId: user.shopId,
      shopName: user.shop?.shopName ?? null,
    };
    logger.info("session_validated", {
      ...sessionLogMeta(session),
      shopAttached: Boolean(user.shop),
      disabled: Boolean(user.disabledAt),
    });
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

export async function login(email: string, password: string, traceId?: string): Promise<SessionUser | null> {
  const normalizedEmail = email.toLowerCase();
  logger.info("login_lookup_started", {
    traceId,
    email: normalizedEmail,
    diagnostics: safeAuthRuntimeDiagnostics(),
  });
  let user: {
    id: string;
    name: string;
    email: string;
    passwordHash: string;
    role: SessionUser["role"];
    shopId: string;
    disabledAt: Date | null;
    tempPasswordExpiresAt: Date | null;
    shop: { id: string; shopName: string } | null;
  } | null;
  try {
    logger.info("auth_trace_login_user_lookup_start", { traceId, email: normalizedEmail });
    user = await withPrismaRetry(() => prisma.user.findUnique({
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
  } catch (error) {
    logger.error("login_user_lookup_failed", {
      traceId,
      email: normalizedEmail,
      error: error instanceof Error ? error.message : "Unknown user lookup error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
  if (!user) {
    logger.warn("login_failed_user_missing", { traceId, email: normalizedEmail });
    return null;
  }
  logger.info("login_user_found", {
    traceId,
    userId: user.id,
    email: user.email,
    role: user.role,
    shopId: user.shopId,
    shopAttached: Boolean(user.shop),
    disabled: Boolean(user.disabledAt),
    tempPasswordExpiresAt: user.tempPasswordExpiresAt?.toISOString() ?? null,
    passwordHash: passwordHashDiagnostics(user.passwordHash),
  });
  if (user.disabledAt) {
    logger.warn("login_failed_disabled_user", { traceId, userId: user.id, email: user.email, role: user.role });
    return null;
  }
  if (!user.shop && user.role !== "SUPER_ADMIN") {
    logger.error("login_failed_missing_shop", { traceId, userId: user.id, email: user.email, role: user.role, shopId: user.shopId });
    return null;
  }
  if (!user.shop && user.role === "SUPER_ADMIN") {
    logger.warn("login_super_admin_platform_shop_missing_non_blocking", {
      traceId,
      userId: user.id,
      email: user.email,
      role: user.role,
      shopId: user.shopId,
    });
  } else {
    logger.info("login_shop_validated", { traceId, userId: user.id, shopId: user.shopId, shopName: user.shop?.shopName });
  }
  if (user.tempPasswordExpiresAt && user.tempPasswordExpiresAt < new Date()) {
    logger.warn("login_temp_password_expired_non_blocking", {
      traceId,
      userId: user.id,
      email: user.email,
      role: user.role,
      tempPasswordExpiresAt: user.tempPasswordExpiresAt.toISOString(),
    });
  }
  let valid = false;
  try {
    logger.info("auth_trace_login_password_compare_start", {
      traceId,
      userId: user.id,
      role: user.role,
      passwordHash: passwordHashDiagnostics(user.passwordHash),
    });
    valid = await bcrypt.compare(password, user.passwordHash);
  } catch (error) {
    logger.error("login_password_compare_failed", {
      traceId,
      userId: user.id,
      email: user.email,
      role: user.role,
      hashLength: user.passwordHash?.length ?? 0,
      error: error instanceof Error ? error.message : "Unknown password compare error",
    });
    throw error;
  }
  if (!valid) {
    logger.warn("login_failed_invalid_password", {
      traceId,
      userId: user.id,
      email: user.email,
      role: user.role,
      passwordHash: passwordHashDiagnostics(user.passwordHash),
    });
    return null;
  }
  logger.info("login_password_validated", { traceId, userId: user.id, email: user.email, role: user.role });
  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      passwordResetRequired: false,
      tempPasswordExpiresAt: null,
    },
  }).catch((error) => {
    logger.error("login_last_login_update_failed_non_blocking", {
      traceId,
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
      traceId,
      userId: user.id,
      email: user.email,
      role: user.role,
      shopId: user.shopId,
      error: error instanceof Error ? error.message : "Unknown activity log error",
    });
  });
  logger.info("login_success", { traceId, userId: user.id, email: user.email, role: user.role, shopId: user.shopId });
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

export async function createPasswordReset(email: string, traceId?: string) {
  const normalizedEmail = email.toLowerCase();
  logger.info("password_reset_lookup_started", {
    traceId,
    email: normalizedEmail,
    diagnostics: safeAuthRuntimeDiagnostics(),
  });
  let user: { id: string; email: string; role: SessionUser["role"]; disabledAt: Date | null } | null;
  try {
    user = await withPrismaRetry(() => prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, role: true, disabledAt: true },
    }), { operation: "password_reset_user_lookup", email: normalizedEmail });
  } catch (error) {
    logger.error("password_reset_user_lookup_failed", {
      traceId,
      email: normalizedEmail,
      error: error instanceof Error ? error.message : "Unknown password reset lookup error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
  if (!user) {
    logger.warn("password_reset_user_missing", { traceId, email: normalizedEmail });
    return null;
  }
  if (user.disabledAt) {
    logger.warn("password_reset_user_disabled", { traceId, userId: user.id, email: user.email, role: user.role });
    return null;
  }

  const token = crypto.randomBytes(32).toString("hex");
  try {
    await withPrismaRetry(() => prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: resetTokenHash(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    }), { operation: "password_reset_token_create", userId: user.id });
    logger.info("password_reset_token_created", { traceId, userId: user.id, email: user.email, role: user.role });
  } catch (error) {
    logger.error("password_reset_token_create_failed", {
      traceId,
      userId: user.id,
      email: user.email,
      role: user.role,
      error: error instanceof Error ? error.message : "Unknown password reset token create error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }

  return {
    email: user.email,
    resetUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/reset-password?token=${token}`,
    token,
  };
}

export async function resetPassword(token: string, password: string, traceId?: string) {
  const tokenHash = resetTokenHash(token);
  logger.info("password_reset_token_validation_started", { traceId, tokenHashPrefix: tokenHash.slice(0, 8) });
  const record = await withPrismaRetry(() => prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true, role: true, disabledAt: true } } },
  }), { operation: "password_reset_token_lookup" });
  if (!record) {
    logger.warn("password_reset_token_missing", { traceId, tokenHashPrefix: tokenHash.slice(0, 8) });
    return false;
  }
  if (record.usedAt) {
    logger.warn("password_reset_token_already_used", { traceId, tokenId: record.id, userId: record.userId });
    return false;
  }
  if (record.expiresAt < new Date()) {
    logger.warn("password_reset_token_expired", { traceId, tokenId: record.id, userId: record.userId, expiresAt: record.expiresAt.toISOString() });
    return false;
  }
  if (record.user.disabledAt) {
    logger.warn("password_reset_user_disabled_on_complete", { traceId, userId: record.user.id, email: record.user.email, role: record.user.role });
    return false;
  }

  try {
    logger.info("password_reset_hash_start", { traceId, userId: record.userId, role: record.user.role });
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
    logger.info("password_reset_password_updated", { traceId, userId: record.userId, role: record.user.role });
  } catch (error) {
    logger.error("password_reset_transaction_failed", {
      traceId,
      userId: record.userId,
      role: record.user.role,
      error: error instanceof Error ? error.message : "Unknown password reset transaction error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }

  return true;
}
