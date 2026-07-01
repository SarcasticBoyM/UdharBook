import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

const STORAGE_NOT_READY_CODES = new Set(["P2021", "P2022"]);

export function isPushSubscriptionStorageNotReady(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && STORAGE_NOT_READY_CODES.has(error.code);
}

export function logPushSubscriptionStorageError(operation: string, error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    logger.error("push_subscription_prisma_error", {
      operation,
      code: error.code,
      meta: error.meta,
    });
    return;
  }

  logger.error("push_subscription_storage_error", {
    operation,
    error: error instanceof Error ? error.message : "Unknown push subscription storage error",
  });
}

export function pushSubscriptionStorageErrorResponse() {
  return {
    ok: false,
    error: "push_subscription_storage_unavailable",
    message: "Push subscription table is missing. Run prisma migrate deploy.",
  } as const;
}
