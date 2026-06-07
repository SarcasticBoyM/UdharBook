import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { distanceMeters, isFieldWorker, startOfDay } from "@/lib/field-tracking";
import { recordFollowUpActivity } from "@/lib/follow-up-service";
import { logger } from "@/lib/logger";

const updateSchema = z.object({
  action: z.enum(["CHECK_OUT", "CANCEL"]),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  notes: z.string().optional(),
  result: z.string().optional(),
  visitType: z.string().optional(),
  outcome: z.string().optional(),
  visitOutcomes: z.array(z.string().min(1)).optional(),
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

function uniqueOutcomes(values: (string | undefined | null)[]) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

function isOrderVisit(visitType?: string | null, outcome?: string | null, outcomes: string[] = []) {
  return ["Sales Visit", "New Lead Visit", "Prospect Visit", "Payment Collection", "Recovery Follow-up"].includes(visitType ?? "") && (outcome === "Order Received" || outcomes.includes("Order Received"));
}

function visitSummary(visitType: string, outcomes: string[], mode?: string | null, amount = 0) {
  const hasPayment = outcomes.includes("Payment Collected") || amount > 0 || mode === "Cheque Collected";
  const hasOrder = outcomes.includes("Order Received");
  const hasFollowUp = outcomes.includes("Follow-up Required") || outcomes.includes("Revisit Required") || outcomes.includes("Payment Promised");

  if (mode === "Cheque Collected" && hasOrder) return "Cheque collected and order received";
  if (hasPayment && hasOrder) return `${mode ?? "Payment"} collected and order received`;
  if (hasOrder) return "Order received during sales visit";
  if (hasPayment) return paymentSummary(mode, amount) ?? "Payment collected during visit";
  if (hasFollowUp) return "Follow-up scheduled from field visit";
  return `${visitType} completed`;
}

type Params = { params: Promise<{ id: string }> };

function errorMessage(error: unknown) {
  if (error instanceof z.ZodError) return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  if (error instanceof Error) return error.message;
  return String(error);
}

function clientError(error: unknown) {
  const message = errorMessage(error);
  if (message === "ORDER_DETAILS_REQUIRED") return "Order details are required when Order Received is selected.";
  if (message === "CUSTOMER_NOT_FOUND") return "Customer was not found for this visit.";
  if (message === "INVALID_ORDER_DELIVERY_DATE") return "Preferred delivery date is invalid.";
  if (message.includes("Invalid enum value") || message.includes("invalid input value for enum")) return "Order status setup is not ready. Please apply the latest Order Desk migration.";
  if (message.includes("Unique constraint")) return "An order is already linked with this visit. Please refresh and try again.";
  if (error instanceof z.ZodError) return `Invalid visit data: ${message}`;
  return `Visit save failed: ${message}`;
}

function appendSystemNote(existing: string | null | undefined, note: string) {
  return [existing, note].filter(Boolean).join("\n");
}

export async function PATCH(request: Request, { params }: Params) {
  const requestId = crypto.randomUUID();
  let sessionId: string | undefined;
  let shopIdForLog: string | undefined;
  let visitIdForLog: string | undefined;
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    sessionId = session.id;

    const { id } = await params;
    visitIdForLog = id;
    const shopId = requireShopId(request, session);
    shopIdForLog = shopId;
    const body = updateSchema.parse(await request.json());
    logger.info("field_visit_checkout_payload", {
      requestId,
      visitId: id,
      shopId,
      userId: session.id,
      action: body.action,
      visitType: body.visitType,
      result: body.result,
      outcome: body.outcome,
      visitOutcomes: body.visitOutcomes,
      hasOrderDetails: Boolean(body.orderProductCategory?.trim()),
      hasDeliveryDate: Boolean(body.orderExpectedDelivery),
      paymentMode: body.paymentMode,
      recoveryAmount: body.recoveryAmount ?? 0,
    });

    const existing = await prisma.staffVisit.findFirst({
      where: { id, shopId },
      include: { customer: { select: { id: true, outstandingBalance: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    if (!isFieldWorker(session) || existing.staffId !== session.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (existing.status !== "CHECKED_IN") {
      logger.warn("field_visit_checkout_blocked_closed_visit", {
        requestId,
        visitId: id,
        shopId,
        userId: session.id,
        currentStatus: existing.status,
      });
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
    const visitOutcomes = uniqueOutcomes([...(body.visitOutcomes ?? []), body.outcome, body.result]);
    const combinedOutcome = visitOutcomes.join(", ") || body.outcome || body.result || "Visit completed";
    const hasOrder = isOrderVisit(body.visitType ?? existing.visitType, combinedOutcome, visitOutcomes);
    if (hasOrder && !body.orderProductCategory?.trim()) {
      logger.warn("field_visit_order_validation_failed", {
        requestId,
        visitId: id,
        shopId,
        userId: session.id,
        reason: "ORDER_DETAILS_REQUIRED",
        visitOutcomes,
      });
      return NextResponse.json({ success: false, error: "Order details are required when Order Received is selected." }, { status: 400 });
    }

    const visit = await prisma.$transaction(async (tx) => {
      logger.info("field_visit_checkout_transaction_start", { requestId, visitId: id, shopId, userId: session.id });
      const duplicateActiveVisits = await tx.staffVisit.findMany({
        where: {
          shopId,
          staffId: existing.staffId,
          status: "CHECKED_IN",
          id: { not: id },
        },
        select: { id: true, notes: true, checkInAt: true },
      });
      for (const duplicate of duplicateActiveVisits) {
        await tx.staffVisit.update({
          where: { id: duplicate.id },
          data: {
            status: "CANCELLED",
            checkOutAt: now,
            notes: appendSystemNote(duplicate.notes, "Auto-closed duplicate active visit while completing another visit."),
          },
        });
      }
      if (duplicateActiveVisits.length > 0) {
        logger.warn("field_visit_duplicate_active_auto_closed", {
          requestId,
          visitId: id,
          shopId,
          staffId: existing.staffId,
          duplicateVisitIds: duplicateActiveVisits.map((visit) => visit.id),
        });
      }

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
          outcome: combinedOutcome,
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
      logger.info("field_visit_checkout_visit_updated", {
        requestId,
        visitId: updated.id,
        shopId,
        userId: session.id,
        visitType: updated.visitType,
        outcome: updated.outcome,
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
        visitOutcomes.includes("Payment Collected") ||
        visitOutcomes.includes("Order Received") ||
        Boolean(nextDate) ||
        recoveryVisitTypes.has(updated.visitType) ||
        visitOutcomes.some((outcome) => followUpOutcomes.has(outcome));
      const status =
        recoveryAmount > 0
          ? recoveryAmount >= existing.customer.outstandingBalance
            ? "PAID"
            : "PARTIAL_PAID"
          : nextDate
            ? "RESCHEDULED"
            : "COMPLETED";
      if (shouldCreateFollowUp) {
        logger.info("field_visit_checkout_followup_start", {
          requestId,
          visitId: updated.id,
          shopId,
          userId: session.id,
          status,
          visitOutcomes,
        });
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
          summary: visitSummary(updated.visitType, visitOutcomes, updated.paymentMode, recoveryAmount),
          detailedNotes: body.notes,
          visitId: updated.id,
          activitySource: "field-visit-checkout",
          metadata: {
            outcome: combinedOutcome,
            visitOutcomes,
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
        logger.info("field_visit_checkout_followup_done", { requestId, visitId: updated.id, shopId, userId: session.id });
      }

      if (isOrderVisit(updated.visitType, updated.outcome, visitOutcomes)) {
        const orderDetails = updated.orderProductCategory?.trim() || "Order received during visit";
        logger.info("field_visit_checkout_order_upsert_start", {
          requestId,
          visitId: updated.id,
          shopId,
          userId: session.id,
          customerId: existing.customerId,
          hasOrderDetails: Boolean(orderDetails),
          preferredDeliveryDate: updated.orderExpectedDelivery?.toISOString() ?? null,
          priority: updated.orderPriority ?? "Normal",
        });
        const order = await tx.order.upsert({
          where: { shopId_staffVisitId: { shopId, staffVisitId: updated.id } },
          create: {
            shopId,
            customerId: existing.customerId,
            createdById: session.id,
            staffVisitId: updated.id,
            orderDetails,
            preferredDeliveryDate: updated.orderExpectedDelivery,
            priority: updated.orderPriority ?? "Normal",
            status: "PENDING",
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
        logger.info("field_visit_checkout_order_upsert_done", {
          requestId,
          visitId: updated.id,
          orderId: order.id,
          shopId,
          userId: session.id,
          status: order.status,
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

      logger.info("field_visit_checkout_transaction_done", { requestId, visitId: updated.id, shopId, userId: session.id });
      return updated;
    });

    logger.info("field_visit_active_state_cleared", {
      requestId,
      visitId: visit.id,
      shopId,
      userId: session.id,
      status: visit.status,
      checkOutAt: visit.checkOutAt?.toISOString() ?? null,
    });
    return NextResponse.json({ success: true, visit, activeVisit: null });
  } catch (error) {
    logger.error("field_visit_checkout_failed", {
      requestId,
      visitId: visitIdForLog,
      shopId: shopIdForLog,
      userId: sessionId,
      error: errorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ success: false, error: clientError(error) }, { status: 400 });
  }
}
