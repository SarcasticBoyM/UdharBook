import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function logActivity(input: {
  action: string;
  shopId?: string;
  userId?: string;
  customerId?: string;
  details?: string;
}) {
  try {
    await prisma.activityLog.create({
      data: {
        action: input.action,
        shopId: input.shopId,
        userId: input.userId,
        customerId: input.customerId,
        details: input.details,
      },
    });
  } catch (error) {
    logger.warn("activity_log_failed", {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
