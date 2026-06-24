import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isDriverAdminRole, isDriverRole } from "@/lib/driver-tracking";

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDriverRole(session.role) && !isDriverAdminRole(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tripId } = await params;
  const trip = await prisma.driverTrip.findFirst({
    where: {
      id: tripId,
      shopId: session.shopId,
      ...(isDriverRole(session.role) ? { driverId: session.id } : {}),
    },
    include: {
      driver: { select: { id: true, name: true } },
      points: {
        orderBy: { capturedAt: "asc" },
        take: 1000,
        select: {
          lat: true,
          lng: true,
          accuracy: true,
          speed: true,
          heading: true,
          distanceFromPreviousMeters: true,
          calculatedSpeedKmph: true,
          isDistanceIgnored: true,
          ignoreReason: true,
          capturedAt: true,
        },
      },
    },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found." }, { status: 404 });
  return NextResponse.json({ success: true, trip });
}
