import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { distanceMeters, endOfDay, startOfDay, visibleStaffId } from "@/lib/field-tracking";

const visitSchema = z.object({
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  mobileNumber: z.string().optional(),
  address: z.string().optional(),
  visitType: z
    .enum(["Collection", "Follow-up", "New Lead", "Complaint", "Cheque Pickup", "Payment Reminder", "Other"])
    .optional(),
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

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const shopId = requireShopId(request, session);
    const { searchParams } = new URL(request.url);
    const staffId = visibleStaffId(session, searchParams.get("staffId"));
    const customerId = searchParams.get("customerId") || undefined;
    const date = searchParams.get("date") ? new Date(searchParams.get("date") as string) : new Date();
    const from = searchParams.get("from") ? new Date(searchParams.get("from") as string) : startOfDay(date);
    const to = searchParams.get("to") ? new Date(searchParams.get("to") as string) : endOfDay(date);

    const visits = await prisma.staffVisit.findMany({
      where: {
        shopId,
        checkInAt: { gte: from, lte: to },
        ...(staffId ? { staffId } : {}),
        ...(customerId ? { customerId } : {}),
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
      activeVisits: visits.filter((visit) => visit.status === "CHECKED_IN").length,
      verifiedVisits: visits.filter((visit) => visit.verified).length,
      recoveryAmount: visits.reduce((sum, visit) => sum + visit.recoveryAmount, 0),
      totalKm: visits.reduce((sum, visit) => sum + visit.travelKm, 0),
    };

    return NextResponse.json({ success: true, visits, summary });
  } catch (error) {
    console.error("Visits load failed", error);
    return NextResponse.json({ success: false, error: "Could not load visits" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const shopId = requireShopId(request, session);
    const body = visitSchema.parse(await request.json());
    const visit = await prisma.$transaction(async (tx) => {
      let customer = body.customerId
        ? await tx.customer.findFirst({
            where: { id: body.customerId, shopId },
            select: { id: true, latitude: true, longitude: true },
          })
        : null;

      if (!customer) {
        const name = body.customerName?.trim();
        if (!name) {
          throw new Error("CUSTOMER_OR_LEAD_REQUIRED");
        }
        const phone = normalizePhone(body.mobileNumber) || temporaryLeadPhone();
        const createdCustomer = await tx.customer.upsert({
          where: { shopId_contactNumber: { shopId, contactNumber: phone } },
          create: {
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
          update: {
            partyName: name,
            notes: body.notes ? `Field visit note: ${body.notes}` : undefined,
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

      await tx.staffLocation.create({
        data: {
          shopId,
          staffId: session.id,
          latitude: body.latitude,
          longitude: body.longitude,
          accuracy: body.accuracy,
          status: "ON_VISIT",
          source: "visit-check-in",
        },
      });

      const created = await tx.staffVisit.create({
        data: {
          shopId,
          staffId: session.id,
          customerId: customer.id,
          checkInLat: body.latitude,
          checkInLng: body.longitude,
          accuracy: body.accuracy,
          notes: body.notes,
          visitType: body.visitType ?? (body.customerId ? "Follow-up" : "New Lead"),
          recoveryAmount: body.recoveryAmount ?? 0,
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

      if (body.nextFollowupDate) {
        const nextDate = new Date(body.nextFollowupDate);
        await tx.followUp.create({
          data: {
            shopId,
            customerId: customer.id,
            followupDate: new Date(),
            status: "RESCHEDULED",
            priority: "MEDIUM",
            notes: body.notes ?? "Scheduled from field visit.",
            nextFollowupDate: nextDate,
            scheduledAt: nextDate,
            createdById: session.id,
          },
        });
        await tx.customer.update({
          where: { id: customer.id },
          data: { lastFollowupDate: new Date(), nextFollowupDate: nextDate },
        });
      }

      return created;
    });

    return NextResponse.json({ success: true, visit });
  } catch (error) {
    console.error("Visit check-in failed", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error && error.message === "CUSTOMER_OR_LEAD_REQUIRED" ? "Customer name is required for a new visit" : "Could not check in visit" },
      { status: 400 },
    );
  }
}
