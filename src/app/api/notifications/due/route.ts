import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { processDueOrderFollowUpReminders } from "@/lib/order-follow-up-reminders";
import { processDueCustomerTaskReminders } from "@/lib/customer-task-reminders";
import { processDueScheduledFollowUpReminders } from "@/lib/follow-up-reminders";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

function hasCronAuthorization(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authorization = request.headers.get("authorization");
  const querySecret = new URL(request.url).searchParams.get("secret");
  return authorization === `Bearer ${secret}` || querySecret === secret;
}

async function processRequest(request: Request) {
  if (hasCronAuthorization(request)) {
    const [orderResult, taskResult, followUpResult] = await Promise.all([
      processDueOrderFollowUpReminders({ limit: 100 }),
      processDueCustomerTaskReminders({ limit: 100 }),
      processDueScheduledFollowUpReminders({ limit: 100 }),
    ]);
    return NextResponse.json({
      success: true,
      processed: orderResult.scanned + taskResult.scanned + followUpResult.scanned,
      queued: orderResult.queued + taskResult.queued + followUpResult.queued,
      failed: orderResult.failed + taskResult.failed + followUpResult.failed,
      checkedAt: new Date(Math.max(orderResult.checkedAt.getTime(), taskResult.checkedAt.getTime(), followUpResult.checkedAt.getTime())).toISOString(),
    });
  }

  const session = await getSession();
  if (!session) {
    const url = new URL(request.url);
    logger.warn("cron_secret_missing_or_invalid", {
      path: url.pathname,
      method: request.method,
      querySecretPresent: Boolean(url.searchParams.get("secret")),
      authorizationPresent: Boolean(request.headers.get("authorization")),
      cronSecretConfigured: Boolean(process.env.CRON_SECRET),
    });
    return NextResponse.json({
      ok: false,
      error: "cron_secret_missing_or_invalid",
      message: "CRON_SECRET is missing or invalid.",
    }, { status: 401 });
  }
  const shopId = requireShopId(request, session);
  const [orderResult, taskResult, followUpResult] = await Promise.all([
    processDueOrderFollowUpReminders({ shopId, recipientUserId: session.id, limit: 20 }),
    processDueCustomerTaskReminders({ shopId, recipientUserId: session.id, limit: 20 }),
    processDueScheduledFollowUpReminders({ shopId, recipientUserId: session.id, limit: 20 }),
  ]);
  return NextResponse.json({
    success: true,
    reminders: [...orderResult.reminders, ...taskResult.reminders, ...followUpResult.reminders],
    checkedAt: new Date(Math.max(orderResult.checkedAt.getTime(), taskResult.checkedAt.getTime(), followUpResult.checkedAt.getTime())).toISOString(),
  });
}

export async function GET(request: Request) {
  return processRequest(request);
}

export async function POST(request: Request) {
  if (!hasCronAuthorization(request)) {
    const url = new URL(request.url);
    logger.warn("cron_secret_missing_or_invalid", {
      path: url.pathname,
      querySecretPresent: Boolean(url.searchParams.get("secret")),
      authorizationPresent: Boolean(request.headers.get("authorization")),
      cronSecretConfigured: Boolean(process.env.CRON_SECRET),
    });
    return NextResponse.json({
      ok: false,
      error: "cron_secret_missing_or_invalid",
      message: "CRON_SECRET is missing or invalid.",
    }, { status: 401 });
  }
  return processRequest(request);
}
