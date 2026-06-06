import { PrismaClient } from "@prisma/client";
import { databaseUrlInfo, isTransientPrismaConnectionError, normalizeDatabaseUrl } from "@/lib/database-url";
import { logger } from "@/lib/logger";

function createPrismaClient() {
  const info = databaseUrlInfo();
  if (info.configured) {
    logger.info("prisma_database_url_config", info);
    if (info.isSupabase && (!info.isPooler || !info.isLikelyTransactionPooler || !info.hasConnectionLimit)) {
      logger.warn("prisma_database_url_should_use_supabase_transaction_pooler", info);
    }
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    datasources: process.env.DATABASE_URL ? { db: { url: normalizeDatabaseUrl(process.env.DATABASE_URL) } } : undefined,
    transactionOptions: {
      maxWait: Number(process.env.PRISMA_TRANSACTION_MAX_WAIT_MS ?? 5000),
      timeout: Number(process.env.PRISMA_TRANSACTION_TIMEOUT_MS ?? 15000),
    },
  });
}

type PrismaClientSingleton = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as { prisma: PrismaClientSingleton | undefined };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function withPrismaRetry<T>(operation: () => Promise<T>, meta?: Record<string, unknown>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientPrismaConnectionError(error)) throw error;
    logger.warn("prisma_transient_connection_error_retrying", {
      ...meta,
      error: error instanceof Error ? error.message : String(error),
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    return operation();
  }
}
