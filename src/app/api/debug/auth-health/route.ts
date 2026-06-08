import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, withPrismaRetry } from "@/lib/db";
import { bcryptSelfTest, jwtSelfTest, passwordHashDiagnostics, safeAuthRuntimeDiagnostics } from "@/lib/auth-diagnostics";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const expected = process.env.AUTH_DEBUG_TOKEN;
  if (!expected || expected.length < 16) {
    return false;
  }
  const provided = request.headers.get("x-auth-debug-token") ?? new URL(request.url).searchParams.get("token");
  return provided === expected;
}

function serializeError(error: unknown) {
  return {
    message: error instanceof Error ? error.message : String(error),
    code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined,
    meta: error instanceof Prisma.PrismaClientKnownRequestError ? error.meta : undefined,
  };
}

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  logger.info("auth_health_requested", {
    traceId,
    authorizedTokenConfigured: Boolean(process.env.AUTH_DEBUG_TOKEN),
    host: request.headers.get("host"),
  });

  if (!isAuthorized(request)) {
    logger.warn("auth_health_unauthorized", { traceId, authDebugTokenConfigured: Boolean(process.env.AUTH_DEBUG_TOKEN) });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const diagnostics: Record<string, unknown> = {
    traceId,
    runtime: safeAuthRuntimeDiagnostics(request),
    checks: {
      dbReachable: false,
      bcryptOperational: false,
      jwtOperational: false,
      userTableReadable: false,
      passwordResetTableReadable: false,
    },
    database: {},
  };

  try {
    await withPrismaRetry(() => prisma.$queryRaw`SELECT 1`, { operation: "auth_health_select_1", traceId });
    diagnostics.checks = { ...(diagnostics.checks as object), dbReachable: true };
  } catch (error) {
    diagnostics.database = { ...(diagnostics.database as object), dbError: serializeError(error) };
  }

  try {
    const [bcryptOk, jwtOk] = await Promise.all([bcryptSelfTest(), jwtSelfTest()]);
    diagnostics.checks = { ...(diagnostics.checks as object), bcryptOperational: bcryptOk, jwtOperational: jwtOk };
  } catch (error) {
    diagnostics.runtimeSelfTestError = serializeError(error);
  }

  try {
    const [roleCounts, missingShopCounts, disabledCounts, hashStats, sampleHashes, shopCount] = await Promise.all([
      withPrismaRetry(() => prisma.$queryRaw<{ role: string; count: number }[]>`
        SELECT role::text AS role, COUNT(*)::int AS count
        FROM "User"
        GROUP BY role::text
        ORDER BY role::text
      `, { operation: "auth_health_role_counts", traceId }),
      withPrismaRetry(() => prisma.$queryRaw<{ role: string; count: number }[]>`
        SELECT u.role::text AS role, COUNT(*)::int AS count
        FROM "User" u
        LEFT JOIN "Shop" s ON s.id = u."shopId"
        WHERE s.id IS NULL
        GROUP BY u.role::text
        ORDER BY u.role::text
      `, { operation: "auth_health_missing_shop_counts", traceId }),
      withPrismaRetry(() => prisma.$queryRaw<{ role: string; count: number }[]>`
        SELECT role::text AS role, COUNT(*)::int AS count
        FROM "User"
        WHERE "disabledAt" IS NOT NULL
        GROUP BY role::text
        ORDER BY role::text
      `, { operation: "auth_health_disabled_counts", traceId }),
      withPrismaRetry(() => prisma.$queryRaw<{ role: string; count: number; min_hash_len: number | null; max_hash_len: number | null }[]>`
        SELECT role::text AS role,
               COUNT(*)::int AS count,
               MIN(LENGTH("passwordHash"))::int AS min_hash_len,
               MAX(LENGTH("passwordHash"))::int AS max_hash_len
        FROM "User"
        GROUP BY role::text
        ORDER BY role::text
      `, { operation: "auth_health_hash_stats", traceId }),
      withPrismaRetry(() => prisma.user.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        select: { role: true, passwordHash: true },
      }), { operation: "auth_health_hash_sample", traceId }),
      withPrismaRetry(() => prisma.shop.count(), { operation: "auth_health_shop_count", traceId }),
    ]);

    diagnostics.checks = { ...(diagnostics.checks as object), userTableReadable: true };
    diagnostics.database = {
      ...(diagnostics.database as object),
      shopCount,
      roleCounts,
      missingShopCounts,
      disabledCounts,
      hashStats,
      passwordHashSamples: sampleHashes.map((sample) => ({
        role: sample.role,
        ...passwordHashDiagnostics(sample.passwordHash),
      })),
    };
  } catch (error) {
    diagnostics.database = { ...(diagnostics.database as object), userDiagnosticsError: serializeError(error) };
  }

  try {
    const tokenCount = await withPrismaRetry(() => prisma.passwordResetToken.count(), {
      operation: "auth_health_password_reset_token_count",
      traceId,
    });
    diagnostics.checks = { ...(diagnostics.checks as object), passwordResetTableReadable: true };
    diagnostics.database = { ...(diagnostics.database as object), passwordResetTokenCount: tokenCount };
  } catch (error) {
    diagnostics.database = { ...(diagnostics.database as object), passwordResetDiagnosticsError: serializeError(error) };
  }

  logger.info("auth_health_completed", { traceId, checks: diagnostics.checks });
  return NextResponse.json(diagnostics);
}

