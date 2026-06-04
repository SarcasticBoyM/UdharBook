import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canDelete } from "@/lib/permissions";
import { normalizePhone } from "@/lib/phone";
import { requireShopId } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";

const updateSchema = z.object({
  partyName: z.string().min(1).optional(),
  contactNumber: z.string().min(1).optional(),
  outstandingBalance: z.number().min(0).optional(),
  notes: z.string().optional().nullable(),
  nextFollowupDate: z.string().datetime().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  geoAddress: z.string().optional().nullable(),
  status: z
    .enum(["ACTIVE", "PENDING", "HIGH_RISK", "CLEARED"])
    .optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const shopId = requireShopId(request, session);
  const customer = await prisma.customer.findFirst({
    where: { id, shopId },
    include: {
      followUps: {
        orderBy: { followupDate: "desc" },
        include: { createdBy: { select: { name: true } } },
      },
      statusHistory: {
        orderBy: { createdAt: "desc" },
        include: { changedBy: { select: { name: true } } },
      },
      payments: {
        orderBy: { paidAt: "desc" },
        include: { createdBy: { select: { name: true } } },
      },
      comments: {
        orderBy: { createdAt: "desc" },
        include: { createdBy: { select: { name: true } } },
      },
      cheques: {
        orderBy: { createdAt: "desc" },
        include: {
          collectedBy: { select: { name: true, role: true } },
          depositedBy: { select: { name: true, role: true } },
          activities: {
            orderBy: { createdAt: "desc" },
            include: { user: { select: { name: true, role: true } } },
            take: 10,
          },
        },
      },
      staffVisits: {
        orderBy: { checkInAt: "desc" },
        take: 20,
        include: {
          staff: { select: { name: true, role: true } },
          photos: { orderBy: { createdAt: "desc" }, take: 4 },
        },
      },
    },
  });

  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(customer);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const body = updateSchema.parse(await request.json());
    const shopId = requireShopId(request, session);
    const data = {
      ...body,
      contactNumber: body.contactNumber ? normalizePhone(body.contactNumber) : undefined,
      nextFollowupDate:
        body.nextFollowupDate === null
          ? null
          : body.nextFollowupDate
            ? new Date(body.nextFollowupDate)
            : undefined,
    };

    const existing = await prisma.customer.findFirst({ where: { id, shopId }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const customer = await prisma.customer.update({ where: { id }, data });
    await logActivity({
      action: "customer_updated",
      userId: session.id,
      shopId,
      customerId: id,
    });
    return NextResponse.json(customer);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canDelete(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const shopId = requireShopId(request, session);
  await prisma.customer.deleteMany({ where: { id, shopId } });
  return NextResponse.json({ ok: true });
}
