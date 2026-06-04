import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { endOfDay, startOfDay, visibleStaffId, workDate } from "@/lib/field-tracking";

const attendanceSchema = z.object({
  action: z.enum(["START", "STOP"]),
});

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const shopId = requireShopId(request, session);
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") ? new Date(searchParams.get("date") as string) : new Date();
    const from = startOfDay(date);
    const to = endOfDay(date);
    const staffId = visibleStaffId(session, searchParams.get("staffId"));

    const [attendances, visits, recoveries] = await prisma.$transaction([
      prisma.attendance.findMany({
        where: { shopId, workDate: { gte: from, lte: to }, ...(staffId ? { staffId } : {}) },
        include: { staff: { select: { id: true, name: true, role: true } } },
        orderBy: { startedAt: "desc" },
      }),
      prisma.staffVisit.groupBy({
        by: ["staffId"],
        where: { shopId, checkInAt: { gte: from, lte: to }, ...(staffId ? { staffId } : {}) },
        orderBy: { staffId: "asc" },
        _count: { id: true },
        _sum: { recoveryAmount: true, travelKm: true },
      }),
      prisma.paymentEntry.groupBy({
        by: ["createdById"],
        where: { shopId, paidAt: { gte: from, lte: to }, ...(staffId ? { createdById: staffId } : {}) },
        orderBy: { createdById: "asc" },
        _sum: { amount: true },
      }),
    ]);

    return NextResponse.json({ success: true, attendances, visits, recoveries });
  } catch (error) {
    console.error("Attendance report failed", error);
    return NextResponse.json({ success: false, error: "Could not load attendance" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const shopId = requireShopId(request, session);
    const body = attendanceSchema.parse(await request.json());
    const today = workDate();

    if (body.action === "START") {
      const attendance = await prisma.attendance.upsert({
        where: { staffId_workDate: { staffId: session.id, workDate: today } },
        create: { shopId, staffId: session.id, workDate: today, startedAt: new Date(), status: "ACTIVE" },
        update: { status: "ACTIVE", endedAt: null },
      });
      return NextResponse.json({ success: true, attendance });
    }

    const attendance = await prisma.attendance.update({
      where: { staffId_workDate: { staffId: session.id, workDate: today } },
      data: { status: "COMPLETED", endedAt: new Date() },
    });

    return NextResponse.json({ success: true, attendance });
  } catch (error) {
    console.error("Attendance update failed", error);
    return NextResponse.json({ success: false, error: "Could not update attendance" }, { status: 400 });
  }
}
