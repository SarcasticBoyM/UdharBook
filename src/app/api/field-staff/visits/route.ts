import { NextResponse } from "next/server";
import { z } from "zod";
import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { distanceMeters, endOfDay, isFieldWorker, startOfDay, visibleStaffId } from "@/lib/field-tracking";
import { logger } from "@/lib/logger";
import { recordFollowUpActivity } from "@/lib/follow-up-service";

const visitSchema = z.object({
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  mobileNumber: z.string().optional(),
  address: z.string().optional(),
  visitType: z
    .enum([
      "Recovery Follow-up",
      "Payment Collection",
      "Sales Visit",
      "New Lead Visit",
      "Prospect Visit",
      "Complaint Visit",
      "Stock Check",
      "Relationship Visit",
      "Service Visit",
      "Market Survey",
      "General Visit",
      "Collection",
      "Follow-up",
      "New Lead",
      "Complaint",
      "Payment Reminder",
      "Other",
    ])
    .optional(),
  outcome: z.string().optional(),
  visitOutcomes: z.array(z.string().min(1)).optional(),
  nextAction: z.string().optional(),
  nextVisitDate: z.string().datetime().optional(),
  orderAmount: z.number().min(0).optional(),
  orderQuantity: z.number().min(0).optional(),
  orderExpectedDelivery: z.string().datetime().optional(),
  orderProductCategory: z.string().optional(),
  orderPriority: z.string().optional(),
  paymentMode: z.enum(["Cash", "NEFT / RTGS", "Cheque Collected"]).optional(),
  paymentReference: z.string().optional(),
  paymentBankName: z.string().optional(),
  paymentScreenshotUrl: z.string().optional(),
  leadArea: z.string().optional(),
  leadContactPerson: z.string().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().optional(),
  notes: z.string().optional(),
  recoveryAmount: z.number().min(0).optional(),
  nextFollowupDate: z.string().datetime().optional(),
});

function normalizePhone(value?: string) {
  return value?.replace(/\D/g, "").slice(-10) || "";
}

function temporaryLeadPhone() {
  return `LEAD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const recoveryVisitTypes = new Set(["Recovery Follow-up", "Payment Collection", "Cheque Pickup", "Collection", "Follow-up", "Payment Reminder"]);
const followUpOutcomes = new Set(["Follow-up Later", "Follow-up Required", "Payment Promised", "Revisit Required", "Customer Unavailable", "Customer Busy", "Call Back Requested", "Not Reachable"]);
const orderReceivedStatus = "PENDING";

function paymentSummary(mode?: string | null, amount = 0) {
  if (mode === "Cash") return `Cash payment collected Rs ${amount}`;
  if (mode === "NEFT / RTGS") return `NEFT payment received${amount > 0 ? ` Rs ${amount}` : ""}`;
  if (mode === "Cheque Collected") return "Cheque collected during visit";
  return null;
}

function uniqueOutcomes(values: (string | undefined | null)[]) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

function isOrderVisit(visitType?: string | null, outcome?: string | null, outcomes: string[] = []) {
  return ["Sales Visit", "New Lead Visit", "Prospect Visit", "Payment Collection", "Recovery Follow-up"].includes(visitType ?? "") && (outcome === "Order Received" || outcomes.includes("Order Received"));
}

function visitSummary(visitType: string, outcomes: string[], mode?: string | null, amount = 0) {
  const hasPayment = outcomes.includes("Payment Collected") || outcomes.includes("Partial Payment") || outcomes.includes("Paid Fully") || amount > 0 || mode === "Cheque Collected";
  const hasOrder = outcomes.includes("Order Received");
  const hasFollowUp = outcomes.some((outcome) => followUpOutcomes.has(outcome));

  if (mode === "Cheque Collected" && hasOrder) return "Cheque collected and order received";
  if (hasPayment && hasOrder) return `${mode ?? "Payment"} collected and order received`;
  if (hasOrder) return "Order received during visit";
  if (hasPayment) return paymentSummary(mode, amount) ?? "Payment collected during visit";
  if (hasFollowUp) return "Follow-up scheduled from field visit";
  return `${visitType} recorded`;
}

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const shopId = requireShopId(request, session);
    const { searchParams } = new URL(request.url);
    const staffId = visibleStaffId(session, searchParams.get("staffId"));
    const customerId = searchParams.get("customerId") || undefined;
    const outcome = searchParams.get("outcome")?.trim();
    const date = searchParams.get("date") ? new Date(searchParams.get("date") as string) : new Date();
    const from = searchParams.get("from") ? new Date(searchParams.get("from") as string) : startOfDay(date);
    const to = searchParams.get("to") ? new Date(searchParams.get("to") as string) : endOfDay(date);
    const visits = await prisma.staffVisit.findMany({
      where: {
        shopId,
        checkInAt: { gte: from, lte: to },
        ...(staffId ? { staffId } : {}),
        ...(customerId ? { customerId } : {}),
        ...(outcome ? { outcome: { contains: outcome, mode: "insensitive" } } : {}),
      },
      include: {
        staff: { select: { id: true, name: true, role: true } },
        customer: {
          select: {
            id: true,
            partyName: true,
            contactNumber: true,
            outstandingBalance: true,
            latitude: true,
            longitude: true,
          },
        },
        photos: { orderBy: { createdAt: "desc" }, take: 6 },
        cheques: {
          orderBy: { createdAt: "desc" },
          take: 6,
          select: {
            id: true,
            chequeNumber: true,
            bankName: true,
            amount: true,
            status: true,
            collectionDateTime: true,
            frontImageUrl: true,
          },
        },
      },
      orderBy: { checkInAt: "desc" },
      take: 200,
    });
    const summary = {
      totalVisits: visits.length,
      completedVisits: visits.filter((visit) => visit.status === "COMPLETED").length,
      activeVisits: 0,
      verifiedVisits: visits.filter((visit) => visit.verified).length,
      recoveryAmount: visits.reduce((sum, visit) => sum + visit.recoveryAmount, 0),
      ordersBooked: visits.filter((visit) => ["Sales Visit", "New Lead Visit", "Prospect Visit"].includes(visit.visitType) && visit.outcome === "Order Received").length,
      orderValue: visits.reduce((sum, visit) => sum + (visit.orderAmount ?? 0), 0),
      newLeads: visits.filter((visit) => visit.visitType === "New Lead Visit" || visit.visitType === "New Lead").length,
      productiveVisits: visits.filter((visit) => visit.status === "COMPLETED" && !["Customer unavailable", "No response"].includes(visit.outcome ?? "")).length,
      pendingFollowups: visits.filter((visit) => visit.nextVisitDate && visit.nextVisitDate > new Date()).length,
      totalKm: visits.reduce((sum, visit) => sum + visit.travelKm, 0),
    };

    return NextResponse.json({ success: true, visits, summary });
  } catch (error) {
    logger.error("field_visits_load_failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ success: false, error: "Could not load visits" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isFieldWorker(session)) {
      return NextResponse.json({ success: false, error: "Only field users can save visits" }, { status: 403 });
    }

    const shopId = requireShopId(request, session);
    const body = visitSchema.parse(await request.json());
    logger.info("field_visit_save_requested", {
      shopId,
      staffId: session.id,
      customerId: body.customerId,
      visitType: body.visitType,
      outcome: body.outcome,
    });
    const createdOrdersForAudit: { id: string; status: OrderStatus }[] = [];
    const visit = await prisma.$transaction(async (tx) => {
      let customer = body.customerId
        ? await tx.customer.findFirst({
            where: { id: body.customerId, shopId, isArchived: false },
            select: { id: true, latitude: true, longitude: true },
          })
        : null;

      if (!customer) {
        const name = body.customerName?.trim();
        if (!name) {
          throw new Error("CUSTOMER_OR_LEAD_REQUIRED");
        }
        const phone = normalizePhone(body.mobileNumber) || temporaryLeadPhone();
        const existingLead = await tx.customer.findFirst({
          where: { shopId, contactNumber: phone, batchTag: null, isArchived: false },
          select: { id: true },
        });
        const createdCustomer = existingLead
          ? await tx.customer.update({
              where: { id: existingLead.id },
              data: {
                partyName: name,
                notes: body.notes ? `Field visit note: ${body.notes}` : undefined,
                latitude: body.latitude,
                longitude: body.longitude,
                geoAddress: body.address,
              },
              select: { id: true, latitude: true, longitude: true },
            })
          : await tx.customer.create({
              data: {
            shopId,
            partyName: name,
            contactNumber: phone,
            outstandingBalance: 0,
            status: "ACTIVE",
            notes: [
              "Temporary lead created from field visit.",
              body.address ? `Address: ${body.address}` : "",
              body.notes ? `Visit notes: ${body.notes}` : "",
            ].filter(Boolean).join("\n"),
            latitude: body.latitude,
            longitude: body.longitude,
            geoAddress: body.address,
          },
              select: { id: true, latitude: true, longitude: true },
            });
        customer = createdCustomer;
      }

      const distance =
        customer.latitude !== null && customer.longitude !== null
          ? distanceMeters(body.latitude, body.longitude, customer.latitude, customer.longitude)
          : null;
      const verified = distance === null ? false : distance <= 200;
      const now = new Date();
      const visitType = body.visitType ?? (body.customerId ? "General Visit" : "New Lead Visit");
      const visitOutcomes = uniqueOutcomes([...(body.visitOutcomes ?? []), body.outcome]);
      const combinedOutcome = visitOutcomes.join(", ") || body.outcome || "Visit recorded";
      const recoveryAmount = body.recoveryAmount ?? 0;
      const nextDate = body.nextFollowupDate ? new Date(body.nextFollowupDate) : body.nextVisitDate ? new Date(body.nextVisitDate) : null;
      const hasOrder = isOrderVisit(visitType, combinedOutcome, visitOutcomes);
      if (hasOrder && !body.orderProductCategory?.trim()) {
        throw new Error("ORDER_DETAILS_REQUIRED");
      }

      await tx.staffLocation.create({
        data: {
          shopId,
          staffId: session.id,
          latitude: body.latitude,
          longitude: body.longitude,
          accuracy: body.accuracy,
          status: "ACTIVE",
          source: "visit-save",
        },
      });

      const created = await tx.staffVisit.create({
        data: {
          shopId,
          staffId: session.id,
          customerId: customer.id,
          status: "COMPLETED",
          checkInAt: now,
          checkOutAt: now,
          checkInLat: body.latitude,
          checkInLng: body.longitude,
          checkOutLat: body.latitude,
          checkOutLng: body.longitude,
          accuracy: body.accuracy,
          notes: body.notes,
          result: combinedOutcome,
          visitType,
          outcome: combinedOutcome,
          nextAction: body.nextAction,
          nextVisitDate: nextDate,
          orderAmount: body.orderAmount,
          orderQuantity: body.orderQuantity,
          orderExpectedDelivery: body.orderExpectedDelivery ? new Date(body.orderExpectedDelivery) : null,
          orderProductCategory: body.orderProductCategory,
          orderPriority: body.orderPriority,
          paymentMode: body.paymentMode,
          paymentReference: body.paymentReference,
          paymentBankName: body.paymentBankName,
          paymentScreenshotUrl: body.paymentScreenshotUrl,
          leadArea: body.leadArea,
          leadContactPerson: body.leadContactPerson,
          visitMetadata: {
            source: body.customerId ? "existing_customer" : "field_lead",
            originalVisitType: body.visitType ?? null,
          },
          recoveryAmount,
          distanceMeters: distance ?? undefined,
          verified,
          outsideWarning: distance !== null && !verified,
        },
        include: {
          customer: { select: { id: true, partyName: true, contactNumber: true, outstandingBalance: true } },
          staff: { select: { name: true, role: true } },
          cheques: true,
        },
      });

      await tx.attendance.upsert({
        where: { staffId_workDate: { staffId: session.id, workDate: startOfDay() } },
        create: { shopId, staffId: session.id, workDate: startOfDay(), startedAt: new Date(), status: "ACTIVE" },
        update: { status: "ACTIVE" },
      });

      await tx.routeHistory.upsert({
        where: { staffId_routeDate: { staffId: session.id, routeDate: startOfDay() } },
        create: {
          shopId,
          staffId: session.id,
          routeDate: startOfDay(),
          totalKm: 0,
          totalVisits: 1,
          productiveHours: 0,
          startedAt: now,
          endedAt: now,
        },
        update: {
          totalVisits: { increment: 1 },
          endedAt: now,
        },
      });

      const shouldCreateFollowUp =
        recoveryAmount > 0 ||
        visitOutcomes.includes("Payment Collected") ||
        visitOutcomes.includes("Partial Payment") ||
        visitOutcomes.includes("Paid Fully") ||
        visitOutcomes.includes("Order Received") ||
        Boolean(nextDate) ||
        recoveryVisitTypes.has(visitType) ||
        visitOutcomes.some((outcome) => followUpOutcomes.has(outcome));
      const status =
        visitOutcomes.includes("Paid Fully")
          ? "PAID"
          : recoveryAmount > 0
            ? "PARTIAL_PAID"
            : nextDate
              ? "RESCHEDULED"
              : "COMPLETED";

      if (shouldCreateFollowUp) {
        await recordFollowUpActivity(tx, {
          shopId,
          customerId: customer.id,
          createdById: session.id,
          status,
          priority: recoveryAmount > 0 ? "HIGH" : "MEDIUM",
          notes: body.notes ?? combinedOutcome,
          customerResponse: combinedOutcome,
          nextFollowupDate: nextDate,
          scheduledAt: nextDate,
          completedAt: now,
          actionLoggedAt: now,
          recoveryAmount,
          paymentStatus: recoveryAmount > 0 ? (status === "PAID" ? "PAID" : "PARTIAL_PAID") : null,
          sourceModule: "FIELD_VISIT",
          followUpType: visitType,
          summary: visitSummary(visitType, visitOutcomes, body.paymentMode, recoveryAmount),
          detailedNotes: body.notes,
          visitId: created.id,
          activitySource: "field-visit-save",
          metadata: {
            outcome: combinedOutcome,
            visitOutcomes,
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

      if (hasOrder) {
        const orderDetails = body.orderProductCategory?.trim() || "Order received during visit";
        const order = await tx.order.create({
          data: {
            shopId,
            customerId: customer.id,
            createdById: session.id,
            staffVisitId: created.id,
            orderDetails,
            preferredDeliveryDate: body.orderExpectedDelivery ? new Date(body.orderExpectedDelivery) : null,
            priority: body.orderPriority ?? "Normal",
            status: orderReceivedStatus,
            sourceModule: "FIELD_VISIT",
            visitSource: visitType,
          },
        });
        createdOrdersForAudit.push({ id: order.id, status: order.status });
        await tx.activityLog.create({
          data: {
            shopId,
            userId: session.id,
            customerId: customer.id,
            action: "order_received",
            details: visitType === "New Lead Visit" || visitType === "Prospect Visit"
              ? "Lead converted with first order"
              : "Order received during field visit",
          },
        });
      }

      logger.info("field_visit_saved", {
        shopId,
        staffId: session.id,
        visitId: created.id,
        customerId: customer.id,
        visitType: created.visitType,
      });
      return created;
    });
    for (const createdOrderForAudit of createdOrdersForAudit) {
      try {
        await prisma.orderActivity.create({
          data: {
            shopId,
            orderId: createdOrderForAudit.id,
            userId: session.id,
            action: "CREATED",
            newStatus: createdOrderForAudit.status,
            notes: "Order received during field visit",
          },
        });
        logger.info("field_visit_order_activity_recorded", {
          shopId,
          staffId: session.id,
          orderId: createdOrderForAudit.id,
        });
      } catch (activityError) {
        logger.error("field_visit_order_activity_record_failed_non_blocking", {
          shopId,
          staffId: session.id,
          orderId: createdOrderForAudit.id,
          error: activityError instanceof Error ? activityError.message : String(activityError),
          stack: activityError instanceof Error ? activityError.stack : undefined,
        });
      }
    }

    return NextResponse.json({ success: true, visit });
  } catch (error) {
    logger.error("field_visit_start_failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error && error.message === "CUSTOMER_OR_LEAD_REQUIRED"
            ? "Customer name is required for a new visit"
            : error instanceof Error && error.message === "ORDER_DETAILS_REQUIRED"
              ? "Order details are required when Order Received is selected."
              : "Could not save visit",
      },
      { status: 400 },
    );
  }
}
