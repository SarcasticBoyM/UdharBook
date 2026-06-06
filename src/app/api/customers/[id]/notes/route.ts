import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { requireShopId } from "@/lib/tenant";
import { recordFollowUpActivity } from "@/lib/follow-up-service";

const schema = z.object({
  note: z.string().min(1).max(2000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "FIELD_SALES") {
    return NextResponse.json({ error: "Field sales notes must be recorded from an active visit workflow" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = schema.parse(await request.json());
    const shopId = requireShopId(request, session);
    const customer = await prisma.customer.findFirst({ where: { id, shopId }, select: { id: true } });
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    const note = await prisma.$transaction(async (tx) => {
      const created = await tx.customerNote.create({
        data: {
          shopId,
          customerId: id,
          note: body.note,
          createdById: session.id,
        },
        include: { createdBy: { select: { name: true } } },
      });
      await recordFollowUpActivity(tx, {
        shopId,
        customerId: id,
        createdById: session.id,
        status: "CONTACTED",
        priority: "LOW",
        notes: body.note,
        sourceModule: "ADMIN_MANUAL",
        followUpType: "ADMIN_NOTE",
        summary: body.note,
        detailedNotes: body.note,
        activitySource: "customer-note",
      });
      return created;
    });

    await logActivity({
      action: "customer_note_added",
      shopId,
      userId: session.id,
      customerId: id,
    });

    return NextResponse.json(note, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
