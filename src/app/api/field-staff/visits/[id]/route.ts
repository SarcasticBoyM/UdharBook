import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { distanceMeters, isFieldAdmin, startOfDay } from "@/lib/field-tracking";

const updateSchema = z.object({
  action: z.enum(["CHECK_OUT", "CANCEL"]),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  notes: z.string().optional(),
  result: z.string().optional(),
  recoveryAmount: z.number().min(0).optional(),
  nextFollowupDate: z.string().datetime().optional(),
  followupNotes: z.string().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const shopId = requireShopId(request, session);
    const body = updateSchema.parse(await request.json());

    const existing = await prisma.staffVisit.findFirst({
      where: { id, shopId },
      include: { customer: { select: { id: true, outstandingBalance: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    if (!isFieldAdmin(session) && existing.staffId !== session.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (existing.status !== "CHECKED_IN") {
      return NextResponse.json({ error: "Visit already closed" }, { status: 409 });
    }

    if (body.action === "CANCEL") {
      const visit = await prisma.staffVisit.update({
        where: { id },
        data: { status: "CANCELLED", checkOutAt: new Date(), notes: body.notes ?? existing.notes },
      });
      return NextResponse.json({ success: true, visit });
    }

    const checkOutLat = body.latitude ?? existing.checkInLat;
    const checkOutLng = body.longitude ?? existing.checkInLng;
    const travelKm =
      distanceMeters(existing.checkInLat, existing.checkInLng, checkOutLat, checkOutLng) / 1000;
    const recoveryAmount = body.recoveryAmount ?? 0;
    const now = new Date();

    const visit = await prisma.$transaction(async (tx) => {
      const updated = await tx.staffVisit.update({
        where: { id },
        data: {
          status: "COMPLETED",
          checkOutAt: now,
          checkOutLat,
          checkOutLng,
          notes: body.notes ?? existing.notes,
          result: body.result,
          recoveryAmount,
          travelKm,
        },
        include: {
          staff: { select: { name: true, role: true } },
          customer: { select: { partyName: true, contactNumber: true, outstandingBalance: true } },
          photos: true,
        },
      });

      await tx.staffLocation.create({
        data: {
          shopId,
          staffId: existing.staffId,
          latitude: checkOutLat,
          longitude: checkOutLng,
          status: "ACTIVE",
          source: "visit-check-out",
        },
      });

      await tx.routeHistory.upsert({
        where: { staffId_routeDate: { staffId: existing.staffId, routeDate: startOfDay() } },
        create: {
          shopId,
          staffId: existing.staffId,
          routeDate: startOfDay(),
          totalKm: travelKm,
          totalVisits: 1,
          productiveHours: (now.getTime() - existing.checkInAt.getTime()) / 3600000,
          startedAt: existing.checkInAt,
          endedAt: now,
        },
        update: {
          totalKm: { increment: travelKm },
          totalVisits: { increment: 1 },
          productiveHours: { increment: (now.getTime() - existing.checkInAt.getTime()) / 3600000 },
          endedAt: now,
        },
      });

      if (recoveryAmount > 0) {
        const nextBalance = Math.max(0, existing.customer.outstandingBalance - recoveryAmount);
        await tx.customer.update({
          where: { id: existing.customerId },
          data: { outstandingBalance: nextBalance, status: nextBalance === 0 ? "CLEARED" : "PENDING" },
        });
        await tx.paymentEntry.create({
          data: {
            shopId,
            customerId: existing.customerId,
            amount: recoveryAmount,
            method: "FIELD_VISIT",
            notes: `Recovered during field visit: ${body.result ?? "Visit completed"}`,
            createdById: session.id,
            paidAt: now,
          },
        });
      }

      if (body.nextFollowupDate) {
        const nextDate = new Date(body.nextFollowupDate);
        await tx.followUp.create({
          data: {
            shopId,
            customerId: existing.customerId,
            followupDate: now,
            status: "RESCHEDULED",
            priority: "MEDIUM",
            notes: body.followupNotes ?? body.notes ?? "Scheduled from field visit.",
            nextFollowupDate: nextDate,
            scheduledAt: nextDate,
            createdById: session.id,
          },
        });
        await tx.customer.update({
          where: { id: existing.customerId },
          data: { lastFollowupDate: now, nextFollowupDate: nextDate },
        });
      }

      return updated;
    });

    return NextResponse.json({ success: true, visit });
  } catch (error) {
    console.error("Visit update failed", error);
    return NextResponse.json({ success: false, error: "Could not update visit" }, { status: 400 });
  }
}
