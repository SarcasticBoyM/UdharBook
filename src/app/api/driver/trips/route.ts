import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isDriverAdminRole, isDriverRole } from "@/lib/driver-tracking";

function dateRange(filter: string, from?: string | null, to?: string | null) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  if (filter === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (filter === "last7days") {
    start.setDate(start.getDate() - 6);
  } else if (filter === "thisMonth") {
    start.setDate(1);
  } else if (filter === "custom" && from && to) {
    const customStart = new Date(`${from}T00:00:00`);
    const customEnd = new Date(`${to}T23:59:59.999`);
    if (!Number.isNaN(customStart.getTime()) && !Number.isNaN(customEnd.getTime())) return { gte: customStart, lte: customEnd };
  } else if (filter === "all") {
    return undefined;
  }
  return { gte: start, lte: end };
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDriverRole(session.role) && !isDriverAdminRole(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const driverId = isDriverRole(session.role) ? session.id : searchParams.get("driverId") || undefined;
  const range = dateRange(searchParams.get("dateFilter") ?? "today", searchParams.get("fromDate"), searchParams.get("toDate"));
  const trips = await prisma.driverTrip.findMany({
    where: {
      shopId: session.shopId,
      ...(driverId ? { driverId } : {}),
      ...(range ? { startedAt: range } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      totalDistanceMeters: true,
      movingDurationSeconds: true,
      idleDurationSeconds: true,
      pointCount: true,
      driver: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json({ success: true, trips });
}
