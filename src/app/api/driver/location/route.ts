import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isDriverRole, validCoordinate } from "@/lib/driver-tracking";

const schema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().optional().nullable(),
  speed: z.number().optional().nullable(),
  heading: z.number().optional().nullable(),
  capturedAt: z.string().datetime().optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDriverRole(session.role)) return NextResponse.json({ error: "Only drivers can update location." }, { status: 403 });
  const body = schema.parse(await request.json());
  if (!validCoordinate(body.lat, body.lng)) return NextResponse.json({ error: "Invalid GPS coordinates." }, { status: 400 });
  const capturedAt = body.capturedAt ? new Date(body.capturedAt) : new Date();
  if (Number.isNaN(capturedAt.getTime())) return NextResponse.json({ error: "Invalid capturedAt timestamp." }, { status: 400 });

  const active = await prisma.driverTrip.findFirst({
    where: { shopId: session.shopId, driverId: session.id, status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
    select: { id: true, lastLocationAt: true },
  });
  if (!active) return NextResponse.json({ error: "Start a trip before sending location." }, { status: 409 });
  if (active.lastLocationAt && capturedAt.getTime() - active.lastLocationAt.getTime() < 3000) {
    return NextResponse.json({ success: true, ignored: true, reason: "Location update throttled." });
  }

  const result = await prisma.$transaction(async (tx) => {
    const point = await tx.driverLocationPoint.create({
      data: {
        shopId: session.shopId,
        driverId: session.id,
        tripId: active.id,
        lat: body.lat,
        lng: body.lng,
        accuracy: body.accuracy ?? undefined,
        speed: body.speed ?? undefined,
        heading: body.heading ?? undefined,
        capturedAt,
      },
    });
    const trip = await tx.driverTrip.update({
      where: { id: active.id },
      data: {
        lastLat: body.lat,
        lastLng: body.lng,
        lastAccuracy: body.accuracy ?? undefined,
        lastSpeed: body.speed ?? undefined,
        lastHeading: body.heading ?? undefined,
        lastLocationAt: capturedAt,
      },
    });
    return { point, trip };
  });

  return NextResponse.json({ success: true, ...result });
}
