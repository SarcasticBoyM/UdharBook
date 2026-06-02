import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canImport } from "@/lib/permissions";
import { requireShopId } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";

const schema = z.object({
  customerIds: z.array(z.string()).min(1),
  nextFollowupDate: z.string().datetime(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canImport(session.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  try {
    const body = schema.parse(await request.json());
    const nextDate = new Date(body.nextFollowupDate);
    const shopId = requireShopId(request, session);

    const result = await prisma.customer.updateMany({
      where: { shopId, id: { in: body.customerIds } },
      data: { nextFollowupDate: nextDate },
    });

    await logActivity({
      action: "bulk_followups_scheduled",
      userId: session.id,
      shopId,
      details: `${result.count} customers scheduled`,
    });

    return NextResponse.json({ updated: result.count });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
