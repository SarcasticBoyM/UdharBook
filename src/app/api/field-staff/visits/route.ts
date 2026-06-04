import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { distanceMeters, endOfDay, startOfDay, visibleStaffId } from "@/lib/field-tracking";

const visitSchema = z.object({
  customerId: z.string(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().optional(),
  notes: z.string().optional(),
});

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
    const customer = await prisma.customer.findFirst({
      where: { id: body.customerId, shopId },
      select: { id: true, latitude: true, longitude: true },
    });
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    const distance =
      customer.latitude !== null && customer.longitude !== null
        ? distanceMeters(body.latitude, body.longitude, customer.latitude, customer.longitude)
        : null;
    const verified = distance === null ? false : distance <= 200;

    const visit = await prisma.$transaction(async (tx) => {
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
          distanceMeters: distance ?? undefined,
          verified,
          outsideWarning: distance !== null && !verified,
        },
        include: {
          customer: { select: { partyName: true, contactNumber: true, outstandingBalance: true } },
          staff: { select: { name: true, role: true } },
        },
      });

      await tx.attendance.upsert({
        where: { staffId_workDate: { staffId: session.id, workDate: startOfDay() } },
        create: { shopId, staffId: session.id, workDate: startOfDay(), startedAt: new Date(), status: "ACTIVE" },
        update: { status: "ACTIVE" },
      });

      return created;
    });

    return NextResponse.json({ success: true, visit });
  } catch (error) {
    console.error("Visit check-in failed", error);
    return NextResponse.json({ success: false, error: "Could not check in visit" }, { status: 400 });
  }
}
