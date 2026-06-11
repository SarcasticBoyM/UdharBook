import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendWhatsAppGroupMessage } from "@/lib/whatsapp-baileys";

export const runtime = "nodejs";

const retryDelayMinutes = [1, 5, 15, 30, 60];

function authorized(request: Request) {
  const token = process.env.WHATSAPP_WORKER_TOKEN;
  if (!token) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${token}`;
}

function nextAttempt(retryCount: number) {
  const minutes = retryDelayMinutes[Math.min(retryCount, retryDelayMinutes.length - 1)] ?? 60;
  return new Date(Date.now() + minutes * 60 * 1000);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const jobs = await prisma.whatsAppNotificationJob.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      nextAttemptAt: { lte: now },
      retryCount: { lt: 5 },
    },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  const results: { id: string; status: string; error?: string }[] = [];
  for (const job of jobs) {
    const claimed = await prisma.whatsAppNotificationJob.updateMany({
      where: { id: job.id, status: job.status },
      data: { status: "PROCESSING", lockedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    try {
      await sendWhatsAppGroupMessage(job.shopId, job.targetGroupJid, job.message);
      await prisma.whatsAppNotificationJob.update({
        where: { id: job.id },
        data: { status: "SENT", sentAt: new Date(), lastError: null },
      });
      results.push({ id: job.id, status: "SENT" });
    } catch (error) {
      const retryCount = job.retryCount + 1;
      const terminal = retryCount >= job.maxRetries;
      const message = error instanceof Error ? error.message : String(error);
      await prisma.whatsAppNotificationJob.update({
        where: { id: job.id },
        data: {
          status: terminal ? "CANCELLED" : "FAILED",
          retryCount,
          nextAttemptAt: terminal ? job.nextAttemptAt : nextAttempt(retryCount),
          lastError: message,
          lockedAt: null,
        },
      });
      await prisma.whatsAppOrderNotificationSetting.updateMany({
        where: { shopId: job.shopId },
        data: { lastError: message },
      });
      logger.error("whatsapp_order_notification_send_failed", {
        shopId: job.shopId,
        jobId: job.id,
        retryCount,
        terminal,
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
      });
      results.push({ id: job.id, status: terminal ? "CANCELLED" : "FAILED", error: message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
