import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { distanceMeters, startOfDay } from "@/lib/field-tracking";
import { recordFollowUpActivity } from "@/lib/follow-up-service";

const updateSchema = z.object({
  action: z.enum(["CHECK_OUT", "CANCEL"]),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  notes: z.string().optional(),
  result: z.string().optional(),
  visitType: z.string().optional(),
  outcome: z.string().optional(),
  nextAction: z.string().optional(),
  recoveryAmount: z.number().min(0).optional(),
  nextFollowupDate: z.string().datetime().optional(),
  followupNotes: z.string().optional(),
  orderAmount: z.number().min(0).optional(),
  orderQuantity: z.number().min(0).optional(),
  orderExpectedDelivery: z.string().datetime().optional(),
  orderProductCategory: z.string().optional(),
  orderPriority: z.string().optional(),
  paymentMode: z.enum(["Cash", "NEFT / RTGS", "Cheque Collected"]).optional(),
  paymentReference: z.string().optional(),
  paymentBankName: z.string().optional(),
  paymentScreenshotUrl: z.string().optional(),
});

const recoveryVisitTypes = new Set(["Recovery Follow-up", "Payment Collection", "Cheque Pickup", "Collection", "Follow-up", "Payment Reminder"]);
const followUpOutcomes = new Set(["Follow-up Required", "Payment Promised", "Revisit Required", "Customer Unavailable", "Customer Busy"]);

function paymentSummary(mode?: string | null, amount = 0) {
  if (mode === "Cash") return `Cash payment collected Rs ${amount}`;
  if (mode === "NEFT / RTGS") return `NEFT payment received${amount > 0 ? ` Rs ${amount}` : ""}`;
  if (mode === "Cheque Collected") return "Cheque collected during payment visit";
  return null;
}

function isOrderVisit(visitType?: string | null, outcome?: string | null) {
  return ["Sales Visit", "New Lead Visit", "Prospect Visit"].includes(visitType ?? "") && outcome === "Order Received";
}

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
    if (session.role !== "STAFF" || existing.staffId !== session.id) {
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
          visitType: body.visitType ?? existing.visitType,
          outcome: body.outcome ?? body.result,
          nextAction: body.nextAction,
          nextVisitDate: body.nextFollowupDate ? new Date(body.nextFollowupDate) : null,
          orderAmount: body.orderAmount,
          orderExpectedDelivery: body.orderExpectedDelivery ? new Date(body.orderExpectedDelivery) : null,
          orderProductCategory: body.orderProductCategory,
          orderPriority: body.orderPriority,
          recoveryAmount,
          travelKm,
          orderQuantity: body.orderQuantity,
          paymentMode: body.paymentMode,
          paymentReference: body.paymentReference,
          paymentBankName: body.paymentBankName,
          paymentScreenshotUrl: body.paymentScreenshotUrl,
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

      const nextDate = body.nextFollowupDate ? new Date(body.nextFollowupDate) : null;
      const shouldCreateFollowUp =
        recoveryAmount > 0 ||
        Boolean(nextDate) ||
        recoveryVisitTypes.has(updated.visitType) ||
        followUpOutcomes.has(body.outcome ?? body.result ?? "");
      const status =
        recoveryAmount > 0
          ? recoveryAmount >= existing.customer.outstandingBalance
            ? "PAID"
            : "PARTIAL_PAID"
          : nextDate
            ? "RESCHEDULED"
            : "COMPLETED";
      if (shouldCreateFollowUp) {
        await recordFollowUpActivity(tx, {
          shopId,
          customerId: existing.customerId,
          createdById: session.id,
          status,
          priority: recoveryAmount > 0 ? "HIGH" : "MEDIUM",
          notes: body.followupNotes ?? body.notes ?? body.result ?? "Field visit completed.",
          customerResponse: body.outcome ?? body.result,
          nextFollowupDate: nextDate,
          scheduledAt: nextDate,
          completedAt: now,
          actionLoggedAt: now,
          recoveryAmount,
          paymentStatus: recoveryAmount > 0 ? (status === "PAID" ? "PAID" : "PARTIAL_PAID") : null,
          sourceModule: "FIELD_VISIT",
          followUpType: updated.visitType,
          summary:
            recoveryAmount > 0
              ? paymentSummary(updated.paymentMode, recoveryAmount) ?? `Field visit recovered Rs ${recoveryAmount}`
              : isOrderVisit(updated.visitType, updated.outcome)
                ? updated.visitType === "New Lead Visit" || updated.visitType === "Prospect Visit"
                  ? "Lead converted with first order"
                  : "Order received during sales visit"
                : updated.paymentMode === "Cheque Collected"
                  ? "Cheque collected during payment visit"
                : `${updated.visitType} completed`,
          detailedNotes: body.notes,
          visitId: updated.id,
          activitySource: "field-visit-checkout",
          metadata: {
            outcome: body.outcome ?? body.result ?? null,
            orderAmount: body.orderAmount ?? null,
            orderQuantity: body.orderQuantity ?? null,
            orderProductCategory: body.orderProductCategory ?? null,
            paymentMode: body.paymentMode ?? null,
            paymentReference: body.paymentReference ?? null,
            paymentBankName: body.paymentBankName ?? null,
            nextAction: body.nextAction ?? null,
          },
          recordPayment: recoveryAmount > 0 && body.paymentMode !== "Cheque Collected",
          paymentMethod: "FIELD_VISIT",
        });
      }

      if (isOrderVisit(updated.visitType, updated.outcome)) {
        const orderDetails = updated.orderProductCategory?.trim() || "Order received during visit";
        await tx.order.upsert({
          where: { shopId_staffVisitId: { shopId, staffVisitId: updated.id } },
          create: {
            shopId,
            customerId: existing.customerId,
            createdById: session.id,
            staffVisitId: updated.id,
            orderDetails,
            preferredDeliveryDate: updated.orderExpectedDelivery,
            priority: updated.orderPriority ?? "Normal",
            sourceModule: "FIELD_VISIT",
            visitSource: updated.visitType,
          },
          update: {
            orderDetails,
            preferredDeliveryDate: updated.orderExpectedDelivery,
            priority: updated.orderPriority ?? "Normal",
            visitSource: updated.visitType,
          },
        });
        await tx.activityLog.create({
          data: {
            shopId,
            userId: session.id,
            customerId: existing.customerId,
            action: "order_received",
            details: updated.visitType === "New Lead Visit" || updated.visitType === "Prospect Visit"
              ? "Lead converted with first order"
              : "Order received during sales visit",
          },
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
