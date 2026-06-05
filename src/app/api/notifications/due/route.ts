import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const shopId = requireShopId(request, session);
  const now = new Date();

  const reminders = await prisma.$transaction(async (tx) => {
    const due = await tx.followUp.findMany({
      where: {
        shopId,
        createdById: session.id,
        manualReminder: true,
        reminderEnabled: true,
        reminderSentAt: null,
        status: { in: ["CALLBACK", "FOLLOW_UP_REQUIRED"] },
        nextFollowUpDateTime: { lte: now },
      },
      include: {
        customer: { select: { id: true, partyName: true, outstandingBalance: true, contactNumber: true } },
      },
      orderBy: { nextFollowUpDateTime: "asc" },
      take: 20,
    });

    if (due.length > 0) {
      await tx.followUp.updateMany({
        where: { id: { in: due.map((item) => item.id) } },
        data: { reminderSentAt: now, remindedAt: now },
      });
    }

    return due;
  });

  const payload = reminders.map((item) => ({
    id: item.id,
    customerId: item.customerId,
    partyName: item.customer.partyName,
    amount: item.customer.outstandingBalance,
    scheduledAt: item.nextFollowUpDateTime,
    dueTime: item.nextFollowUpDateTime,
    callbackNote: item.reminderNotes ?? item.notes,
    priority: item.priority,
    missed: item.nextFollowUpDateTime ? item.nextFollowUpDateTime < now : false,
  }));

  return NextResponse.json({ reminders: payload, checkedAt: now.toISOString() });
}
