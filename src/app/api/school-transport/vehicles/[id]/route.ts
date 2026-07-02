import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isSchoolTransportAdmin } from "@/lib/school-transport";
const schema = z.object({ name: z.string().trim().min(1).max(100).optional(), vehicleNumber: z.string().trim().max(40).optional().nullable(), driverId: z.string().optional().nullable(), isActive: z.boolean().optional() });
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSchoolTransportAdmin(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await context.params; const body = schema.parse(await request.json());
  const existing = await prisma.schoolVehicle.findFirst({ where: { id, shopId: session.shopId } });
  if (!existing) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  if (body.driverId) { const driver = await prisma.user.findFirst({ where: { id: body.driverId, shopId: session.shopId, role: "SCHOOL_DRIVER", disabledAt: null } }); if (!driver) return NextResponse.json({ error: "School driver not found." }, { status: 400 }); }
  const vehicle = await prisma.schoolVehicle.update({
    where: { id },
    data: {
      ...body,
      ...(body.vehicleNumber !== undefined ? { vehicleNumber: body.vehicleNumber || null } : {}),
      ...(body.driverId !== undefined ? { driverId: body.driverId || null } : {}),
    },
  });
  return NextResponse.json({ vehicle });
}
