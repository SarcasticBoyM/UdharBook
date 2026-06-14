import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { processDueOrderFollowUpReminders } from "@/lib/order-follow-up-reminders";
import { processDueCustomerTaskReminders } from "@/lib/customer-task-reminders";

function hasCronAuthorization(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function processRequest(request: Request) {
  if (hasCronAuthorization(request)) {
    const [orderResult, taskResult] = await Promise.all([
      processDueOrderFollowUpReminders({ limit: 100 }),
      processDueCustomerTaskReminders({ limit: 100 }),
    ]);
    return NextResponse.json({
      success: true,
      processed: orderResult.scanned + taskResult.scanned,
      queued: orderResult.queued + taskResult.queued,
      failed: orderResult.failed + taskResult.failed,
      checkedAt: new Date(Math.max(orderResult.checkedAt.getTime(), taskResult.checkedAt.getTime())).toISOString(),
    });
  }

  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const shopId = requireShopId(request, session);
  const [orderResult, taskResult] = await Promise.all([
    processDueOrderFollowUpReminders({ shopId, recipientUserId: session.id, limit: 20 }),
    processDueCustomerTaskReminders({ shopId, recipientUserId: session.id, limit: 20 }),
  ]);
  return NextResponse.json({
    success: true,
    reminders: [...orderResult.reminders, ...taskResult.reminders],
    checkedAt: new Date(Math.max(orderResult.checkedAt.getTime(), taskResult.checkedAt.getTime())).toISOString(),
  });
}

export async function GET(request: Request) {
  return processRequest(request);
}

export async function POST(request: Request) {
  if (!hasCronAuthorization(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return processRequest(request);
}
