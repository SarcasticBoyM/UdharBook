import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { distanceMeters, getGeofenceStatus, isValidLatLng } from "@/lib/geo";
import { isSalesRole } from "@/lib/operational-roles";
import { requireShopId } from "@/lib/tenant";

const schema = z.object({
  customerId: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().min(0),
  notes: z.string().trim().max(2000).optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!isSalesRole(session.role)) return NextResponse.json({ success: false, error: "Only sales persons can punch customer visits." }, { status: 403 });

  try {
    const shopId = requireShopId(request, session);
    const body = schema.parse(await request.json());
    if (!isValidLatLng(body.lat, body.lng)) return NextResponse.json({ success: false, error: "Invalid GPS coordinates." }, { status: 400 });
    const customer = await prisma.customer.findFirst({
      where: { id: body.customerId, shopId, isArchived: false },
      select: { id: true, latitude: true, longitude: true, geofenceRadiusM: true },
    });
    if (!customer) return NextResponse.json({ success: false, error: "Customer not found." }, { status: 404 });
    if (customer.latitude == null || customer.longitude == null) {
      return NextResponse.json({ success: false, error: "Customer location not configured. Ask admin to set location.", geoFenceStatus: "LOCATION_MISSING" }, { status: 400 });
    }
    const radius = customer.geofenceRadiusM || 100;
    const distance = distanceMeters(body.lat, body.lng, customer.latitude, customer.longitude);
    const geoFenceStatus = getGeofenceStatus(distance, radius, body.accuracy);
    if (geoFenceStatus === "GPS_LOW_ACCURACY") {
      return NextResponse.json({ success: false, error: `GPS accuracy is too low (${Math.round(body.accuracy ?? 0)}m). Move outdoors and retry.`, geoFenceStatus, distanceMeters: Math.round(distance), radiusM: radius }, { status: 400 });
    }
    if (geoFenceStatus === "OUTSIDE") {
      return NextResponse.json({ success: false, error: `You are ${Math.round(distance)}m away. Punch allowed within ${radius}m.`, geoFenceStatus, distanceMeters: Math.round(distance), radiusM: radius }, { status: 400 });
    }
    const now = new Date();
    const visit = await prisma.staffVisit.create({
      data: {
        shopId,
        staffId: session.id,
        customerId: customer.id,
        status: "COMPLETED",
        checkInAt: now,
        checkOutAt: now,
        checkInLat: body.lat,
        checkInLng: body.lng,
        checkOutLat: body.lat,
        checkOutLng: body.lng,
        accuracy: body.accuracy,
        distanceMeters: distance,
        verified: true,
        outsideWarning: false,
        geoFenceStatus: "INSIDE",
        geoFenceRadiusM: radius,
        locationCapturedAt: now,
        deviceInfo: request.headers.get("user-agent")?.slice(0, 500),
        notes: body.notes,
        result: "Location verified visit punch",
        outcome: "Location verified visit punch",
        visitType: "Customer Visit",
      },
      select: { id: true, checkInAt: true, verified: true, geoFenceStatus: true, distanceMeters: true, geoFenceRadiusM: true },
    });
    return NextResponse.json({ success: true, visit, distanceMeters: Math.round(distance), radiusM: radius });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof z.ZodError ? "Invalid visit punch details." : "Could not punch visit." }, { status: 400 });
  }
}
