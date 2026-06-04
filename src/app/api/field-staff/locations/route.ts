import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { freshnessStatus, isFieldAdmin, startOfDay, visibleStaffId, workDate } from "@/lib/field-tracking";

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().optional(),
  battery: z.number().optional(),
  status: z.enum(["ACTIVE", "ON_VISIT", "IDLE", "OFFLINE"]).optional(),
  source: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const shopId = requireShopId(request, session);
    const { searchParams } = new URL(request.url);
    const staffId = visibleStaffId(session, searchParams.get("staffId"));
    const today = startOfDay();

    const staff = await prisma.user.findMany({
      where: { shopId, ...(staffId ? { id: staffId } : { role: "STAFF" }) },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    });

    const [locations, openVisits, attendances] = await prisma.$transaction([
      prisma.staffLocation.findMany({
        where: { shopId, createdAt: { gte: today }, ...(staffId ? { staffId } : {}) },
        orderBy: { createdAt: "desc" },
        take: 1000,
      }),
      prisma.staffVisit.findMany({
        where: { shopId, status: "CHECKED_IN", ...(staffId ? { staffId } : {}) },
        include: { customer: { select: { partyName: true, contactNumber: true } } },
      }),
      prisma.attendance.findMany({
        where: { shopId, workDate: today, ...(staffId ? { staffId } : {}) },
      }),
    ]);

    const latestByStaff = new Map<string, (typeof locations)[number]>();
    locations.forEach((location) => {
      if (!latestByStaff.has(location.staffId)) latestByStaff.set(location.staffId, location);
    });

    const openVisitByStaff = new Map(openVisits.map((visit) => [visit.staffId, visit]));
    const attendanceByStaff = new Map(attendances.map((attendance) => [attendance.staffId, attendance]));

    return NextResponse.json({
      success: true,
      staff: staff.map((person) => {
        const latest = latestByStaff.get(person.id);
        const openVisit = openVisitByStaff.get(person.id);
        return {
          ...person,
          latestLocation: latest,
          status: freshnessStatus(latest?.createdAt, Boolean(openVisit)),
          openVisit,
          attendance: attendanceByStaff.get(person.id) ?? null,
        };
      }),
      routePoints: isFieldAdmin(session) || staffId === session.id ? locations.reverse() : [],
    });
  } catch (error) {
    console.error("Field staff locations failed", error);
    return NextResponse.json({ success: false, error: "Could not load staff locations" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const shopId = requireShopId(request, session);
    const body = locationSchema.parse(await request.json());
    const today = workDate();

    const location = await prisma.$transaction(async (tx) => {
      await tx.attendance.upsert({
        where: { staffId_workDate: { staffId: session.id, workDate: today } },
        create: { shopId, staffId: session.id, workDate: today, startedAt: new Date(), status: "ACTIVE" },
        update: { status: "ACTIVE" },
      });

      const created = await tx.staffLocation.create({
        data: {
          shopId,
          staffId: session.id,
          latitude: body.latitude,
          longitude: body.longitude,
          accuracy: body.accuracy,
          battery: body.battery,
          status: body.status ?? "ACTIVE",
          source: body.source ?? "browser",
        },
      });

      await tx.routeHistory.upsert({
        where: { staffId_routeDate: { staffId: session.id, routeDate: today } },
        create: {
          shopId,
          staffId: session.id,
          routeDate: today,
          startedAt: new Date(),
          path: [{ lat: body.latitude, lng: body.longitude, at: created.createdAt.toISOString() }],
        },
        update: {
          endedAt: new Date(),
        },
      });

      return created;
    });

    return NextResponse.json({ success: true, location });
  } catch (error) {
    console.error("Field staff location update failed", error);
    return NextResponse.json({ success: false, error: "Could not update location" }, { status: 400 });
  }
}
