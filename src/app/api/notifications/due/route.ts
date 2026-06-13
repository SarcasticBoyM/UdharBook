import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { processDueOrderFollowUpReminders } from "@/lib/order-follow-up-reminders";

function hasCronAuthorization(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function processRequest(request: Request) {
  if (hasCronAuthorization(request)) {
    const result = await processDueOrderFollowUpReminders({ limit: 100 });
    return NextResponse.json({
      success: true,
      processed: result.scanned,
      queued: result.queued,
      failed: result.failed,
      checkedAt: result.checkedAt.toISOString(),
    });
  }

  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const shopId = requireShopId(request, session);
  const result = await processDueOrderFollowUpReminders({
    shopId,
    recipientUserId: session.id,
    limit: 20,
  });
  return NextResponse.json({
    success: true,
    reminders: result.reminders,
    checkedAt: result.checkedAt.toISOString(),
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
