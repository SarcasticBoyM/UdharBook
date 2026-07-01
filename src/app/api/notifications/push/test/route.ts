import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { pushEndpointHash, sendTestPush } from "@/lib/web-push";
import { logger } from "@/lib/logger";
import {
  isPushSubscriptionStorageNotReady,
  logPushSubscriptionStorageError,
  pushSubscriptionStorageErrorResponse,
} from "@/lib/push-subscription-storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await request.json().catch(() => ({}));
  try {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: session.id, shopId: session.shopId, isActive: true },
      select: { id: true, endpoint: true, p256dhKey: true, authKey: true },
    });
    const counts = {
      totalSubscriptions: subscriptions.length,
      attemptedCount: subscriptions.length,
      sentCount: 0,
      failedCount: 0,
      inactiveCount: 0,
    };
    if (subscriptions.length === 0) {
      return NextResponse.json({
        ok: false,
        ...counts,
        error: "no_active_push_subscription",
        message: "No active push subscription found for this user/device",
      }, { status: 404 });
    }

    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await sendTestPush(subscription);
        counts.sentCount += 1;
      } catch (error) {
        const statusCode = typeof error === "object" && error && "statusCode" in error
          ? Number((error as { statusCode?: number }).statusCode)
          : 0;
        const responseBody = typeof error === "object" && error && "body" in error
          ? String((error as { body?: unknown }).body).slice(0, 500)
          : undefined;
        counts.failedCount += 1;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.update({
            where: { id: subscription.id },
            data: { isActive: false },
          });
          counts.inactiveCount += 1;
        }
        logger.warn("web_push_test_delivery_failed", {
          userId: session.id,
          shopId: session.shopId,
          endpointHash: pushEndpointHash(subscription.endpoint),
          statusCode,
          responseBody,
          error: error instanceof Error ? error.message.slice(0, 500) : "Unknown push delivery error",
        });
      }
    }));

    if (counts.sentCount === 0) {
      return NextResponse.json({
        ok: false,
        ...counts,
        error: "push_delivery_failed",
        message: counts.inactiveCount > 0
          ? "Saved push subscription expired and was disabled. Enable phone notifications again."
          : "Push notification delivery failed for all active subscriptions.",
      }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      success: true,
      ...counts,
      message: counts.failedCount > 0
        ? `Test notification sent to ${counts.sentCount} device(s); ${counts.failedCount} failed.`
        : "Test notification sent successfully.",
    });
  } catch (error) {
    logPushSubscriptionStorageError("test", error);
    if (isPushSubscriptionStorageNotReady(error)) {
      return NextResponse.json(pushSubscriptionStorageErrorResponse(), { status: 503 });
    }
    return NextResponse.json({
      ok: false,
      error: "push_test_failed",
      message: error instanceof Error ? error.message : "Test notification could not be sent.",
    }, { status: 500 });
  }
}
