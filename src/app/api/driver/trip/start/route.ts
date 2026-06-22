import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ensureDriverTrackingLink, isDriverRole, validCoordinate } from "@/lib/driver-tracking";

const schema = z.object({
  lat: z.number().optional(),
  lng: z.number().optional(),
  accuracy: z.number().optional().nullable(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDriverRole(session.role)) return NextResponse.json({ error: "Only drivers can start trips." }, { status: 403 });
  const body = schema.parse(await request.json().catch(() => ({})));
  if ((body.lat !== undefined || body.lng !== undefined) && !validCoordinate(body.lat ?? Number.NaN, body.lng ?? Number.NaN)) {
    return NextResponse.json({ error: "Invalid GPS coordinates." }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    await ensureDriverTrackingLink(tx, { shopId: session.shopId, driverId: session.id });
    const existing = await tx.driverTrip.findFirst({
      where: { shopId: session.shopId, driverId: session.id, status: "ACTIVE" },
      orderBy: { startedAt: "desc" },
    });
    if (existing) return existing;
    const now = new Date();
    return tx.driverTrip.create({
      data: {
        shopId: session.shopId,
        driverId: session.id,
        startedAt: now,
        startLat: body.lat,
        startLng: body.lng,
        lastLat: body.lat,
        lastLng: body.lng,
        lastAccuracy: body.accuracy ?? undefined,
        lastLocationAt: body.lat !== undefined ? now : undefined,
      },
    });
  });

  return NextResponse.json({ success: true, trip: result });
}
