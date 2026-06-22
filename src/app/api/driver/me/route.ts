import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ensureDriverTrackingLink, isDriverRole, publicTrackingUrl } from "@/lib/driver-tracking";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDriverRole(session.role)) return NextResponse.json({ error: "Only drivers can use this endpoint." }, { status: 403 });

  const data = await prisma.$transaction(async (tx) => {
    const link = await ensureDriverTrackingLink(tx, { shopId: session.shopId, driverId: session.id });
    const activeTrip = await tx.driverTrip.findFirst({
      where: { shopId: session.shopId, driverId: session.id, status: "ACTIVE" },
      orderBy: { startedAt: "desc" },
    });
    const latestTrip = activeTrip ?? await tx.driverTrip.findFirst({
      where: { shopId: session.shopId, driverId: session.id },
      orderBy: { updatedAt: "desc" },
    });
    return { link, trip: latestTrip };
  });

  return NextResponse.json({
    success: true,
    driver: { id: session.id, name: session.name },
    trip: data.trip,
    trackingLink: publicTrackingUrl(data.link.token),
    token: data.link.token,
    linkEnabled: data.link.isEnabled,
  });
}
