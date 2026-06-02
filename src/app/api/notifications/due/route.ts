import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const shopId = requireShopId(request, session);
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);

  const reminders = await prisma.followUp.findMany({
    where: {
      shopId,
      status: { in: ["PENDING", "RESCHEDULED"] },
      scheduledAt: { lte: inOneHour },
    },
    include: {
      customer: { select: { id: true, partyName: true, outstandingBalance: true, contactNumber: true } },
    },
    orderBy: { scheduledAt: "asc" },
    take: 50,
  });

  const payload = reminders.map((item) => ({
    id: item.id,
    customerId: item.customerId,
    partyName: item.customer.partyName,
    amount: item.customer.outstandingBalance,
    scheduledAt: item.scheduledAt,
    priority: item.priority,
    missed: item.scheduledAt ? item.scheduledAt < now : false,
  }));

  return NextResponse.json({ reminders: payload, checkedAt: now.toISOString() });
}
