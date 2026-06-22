import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isDriverRole, validCoordinate } from "@/lib/driver-tracking";

const schema = z.object({
  lat: z.number().optional(),
  lng: z.number().optional(),
  accuracy: z.number().optional().nullable(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDriverRole(session.role)) return NextResponse.json({ error: "Only drivers can stop trips." }, { status: 403 });
  const body = schema.parse(await request.json().catch(() => ({})));
  const hasLocation = body.lat !== undefined || body.lng !== undefined;
  if (hasLocation && !validCoordinate(body.lat ?? Number.NaN, body.lng ?? Number.NaN)) {
    return NextResponse.json({ error: "Invalid GPS coordinates." }, { status: 400 });
  }

  const active = await prisma.driverTrip.findFirst({
    where: { shopId: session.shopId, driverId: session.id, status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
  });
  if (!active) return NextResponse.json({ success: true, trip: null });
  const now = new Date();
  const trip = await prisma.driverTrip.update({
    where: { id: active.id },
    data: {
      status: "ENDED",
      endedAt: now,
      endLat: hasLocation ? body.lat : active.lastLat,
      endLng: hasLocation ? body.lng : active.lastLng,
      lastLat: hasLocation ? body.lat : active.lastLat,
      lastLng: hasLocation ? body.lng : active.lastLng,
      lastAccuracy: body.accuracy ?? active.lastAccuracy,
      lastLocationAt: hasLocation ? now : active.lastLocationAt,
    },
  });
  return NextResponse.json({ success: true, trip });
}
