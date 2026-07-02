import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isSchoolTransportAdmin } from "@/lib/school-transport";

const schema = z.object({ name: z.string().trim().min(1).max(100), vehicleNumber: z.string().trim().max(40).optional().nullable(), driverId: z.string().optional().nullable(), isActive: z.boolean().optional() });

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSchoolTransportAdmin(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [vehicles, drivers] = await Promise.all([
    prisma.schoolVehicle.findMany({ where: { shopId: session.shopId }, include: { driver: { select: { id: true, name: true } }, trackingLinks: { include: { route: { select: { name: true } } }, orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" } }),
    prisma.user.findMany({ where: { shopId: session.shopId, role: "SCHOOL_DRIVER", disabledAt: null }, select: { id: true, name: true } }),
  ]);
  return NextResponse.json({ vehicles, drivers });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSchoolTransportAdmin(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = schema.parse(await request.json());
  if (body.driverId) {
    const driver = await prisma.user.findFirst({ where: { id: body.driverId, shopId: session.shopId, role: "SCHOOL_DRIVER", disabledAt: null } });
    if (!driver) return NextResponse.json({ error: "School driver not found." }, { status: 400 });
  }
  const vehicle = await prisma.schoolVehicle.create({ data: { shopId: session.shopId, name: body.name, vehicleNumber: body.vehicleNumber || null, driverId: body.driverId || null, isActive: body.isActive ?? true } });
  return NextResponse.json({ vehicle }, { status: 201 });
}
