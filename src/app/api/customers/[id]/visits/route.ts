import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canReadCustomers } from "@/lib/permissions";
import { isSalesRole } from "@/lib/operational-roles";
import { requireShopId } from "@/lib/tenant";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!canReadCustomers(session.role)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const shopId = requireShopId(request, session);
  const customer = await prisma.customer.findFirst({ where: { id, shopId }, select: { id: true } });
  if (!customer) return NextResponse.json({ success: false, error: "Customer not found." }, { status: 404 });
  const visits = await prisma.staffVisit.findMany({
    where: { shopId, customerId: id, ...(isSalesRole(session.role) ? { staffId: session.id } : {}) },
    orderBy: { checkInAt: "desc" },
    take: 100,
    select: {
      id: true, checkInAt: true, checkOutAt: true, visitType: true, outcome: true, notes: true,
      verified: true, geoFenceStatus: true, distanceMeters: true, geoFenceRadiusM: true, accuracy: true,
      staff: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json({ success: true, visits });
}
