import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendTestPush } from "@/lib/web-push";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { endpoint?: unknown };
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : null;
  const subscription = await prisma.pushSubscription.findFirst({
    where: {
      userId: session.id,
      shopId: session.shopId,
      isActive: true,
      ...(endpoint ? { endpoint } : {}),
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!subscription) return NextResponse.json({ error: "Enable phone notifications on this device first." }, { status: 400 });
  try {
    await sendTestPush(subscription.id, session.id, session.shopId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const statusCode = typeof error === "object" && error && "statusCode" in error
      ? Number((error as { statusCode?: number }).statusCode)
      : 0;
    if (statusCode === 404 || statusCode === 410) {
      await prisma.pushSubscription.update({ where: { id: subscription.id }, data: { isActive: false } });
    }
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Test notification could not be sent.",
    }, { status: statusCode === 404 || statusCode === 410 ? 410 : 500 });
  }
}
