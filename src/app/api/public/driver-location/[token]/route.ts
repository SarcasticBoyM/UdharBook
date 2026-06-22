import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const link = await prisma.driverTrackingLink.findUnique({
    where: { token },
    select: {
      isEnabled: true,
      driver: { select: { name: true } },
      driverId: true,
      shopId: true,
    },
  });
  if (!link || !link.isEnabled) return NextResponse.json({ success: false, error: "Tracking link is disabled or not found." }, { status: 404 });
  const trip = await prisma.driverTrip.findFirst({
    where: { shopId: link.shopId, driverId: link.driverId },
    orderBy: { updatedAt: "desc" },
    select: {
      status: true,
      startedAt: true,
      endedAt: true,
      lastLat: true,
      lastLng: true,
      lastAccuracy: true,
      lastLocationAt: true,
    },
  });
  return NextResponse.json({
    success: true,
    driverName: link.driver.name,
    isActive: trip?.status === "ACTIVE",
    lat: trip?.lastLat ?? null,
    lng: trip?.lastLng ?? null,
    accuracy: trip?.lastAccuracy ?? null,
    lastLocationAt: trip?.lastLocationAt ?? null,
    tripStartedAt: trip?.startedAt ?? null,
    tripEndedAt: trip?.endedAt ?? null,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
