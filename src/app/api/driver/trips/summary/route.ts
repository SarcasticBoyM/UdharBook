import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isDriverAdminRole, isDriverRole } from "@/lib/driver-tracking";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDriverRole(session.role) && !isDriverAdminRole(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const driverId = isDriverRole(session.role) ? session.id : new URL(request.url).searchParams.get("driverId") || undefined;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [activeTrip, today] = await Promise.all([
    prisma.driverTrip.findFirst({
      where: { shopId: session.shopId, ...(driverId ? { driverId } : {}), status: "ACTIVE" },
      orderBy: { startedAt: "desc" },
    }),
    prisma.driverTrip.aggregate({
      where: { shopId: session.shopId, ...(driverId ? { driverId } : {}), startedAt: { gte: todayStart } },
      _sum: { totalDistanceMeters: true },
      _count: { id: true },
    }),
  ]);
  return NextResponse.json({
    success: true,
    activeTrip,
    todayKm: Number(((today._sum.totalDistanceMeters ?? 0) / 1000).toFixed(2)),
    tripCountToday: today._count.id,
  });
}
