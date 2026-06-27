import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isValidLatLng } from "@/lib/geo";
import { isShopAdminRole } from "@/lib/operational-roles";
import { requireShopId } from "@/lib/tenant";

const locationSchema = z.object({
  googleMapsUrl: z.string().trim().max(2000).optional().nullable(),
  locationName: z.string().trim().max(200).optional().nullable(),
  locationAddress: z.string().trim().max(1000).optional().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  radius: z.number().int().min(30).max(1000).default(100),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!isShopAdminRole(session.role)) return NextResponse.json({ success: false, error: "Only shop admins can update customer location." }, { status: 403 });

  try {
    const { id } = await params;
    const shopId = requireShopId(request, session);
    const body = locationSchema.parse(await request.json());
    if (!isValidLatLng(body.latitude, body.longitude)) {
      return NextResponse.json({ success: false, error: "Enter valid latitude and longitude." }, { status: 400 });
    }
    const result = await prisma.customer.updateMany({
      where: { id, shopId },
      data: {
        googleMapsUrl: body.googleMapsUrl || null,
        locationName: body.locationName || null,
        geoAddress: body.locationAddress || null,
        latitude: body.latitude,
        longitude: body.longitude,
        geofenceRadiusM: body.radius,
        locationVerifiedAt: new Date(),
        locationUpdatedById: session.id,
      },
    });
    if (!result.count) return NextResponse.json({ success: false, error: "Customer not found." }, { status: 404 });
    const customer = await prisma.customer.findFirst({
      where: { id, shopId },
      select: { locationName: true, geoAddress: true, googleMapsUrl: true, latitude: true, longitude: true, geofenceRadiusM: true, locationVerifiedAt: true },
    });
    return NextResponse.json({ success: true, location: customer });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof z.ZodError ? "Check the location fields and radius." : "Could not update customer location." }, { status: 400 });
  }
}
