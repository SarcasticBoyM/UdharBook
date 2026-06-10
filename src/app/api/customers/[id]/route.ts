import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canDelete, canManageCustomers } from "@/lib/permissions";
import { normalizePhone } from "@/lib/phone";
import { requireShopId } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";

const updateSchema = z.object({
  action: z.enum(["archive", "restore"]).optional(),
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
  if (!canManageCustomers(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
          collectedBy: { select: { name: true } },
          depositedBy: { select: { name: true } },
          activities: {
            orderBy: { createdAt: "desc" },
            include: { user: { select: { name: true } } },
            take: 10,
          },
        },
      },
      staffVisits: {
        orderBy: { checkInAt: "desc" },
        take: 20,
        include: {
          staff: { select: { name: true } },
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
    if (body.action === "archive" || body.action === "restore") {
      if (!canManageCustomers(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const customer = await prisma.customer.updateMany({
        where: { id, shopId },
        data: body.action === "archive"
          ? { isArchived: true, archivedAt: new Date(), archivedById: session.id, nextFollowupDate: null }
          : { isArchived: false, archivedAt: null, archivedById: null },
      });
      if (!customer.count) return NextResponse.json({ error: "Not found" }, { status: 404 });
      await logActivity({
        action: body.action === "archive" ? "customer_archived" : "customer_restored",
        userId: session.id,
        shopId,
        customerId: id,
      });
      const updated = await prisma.customer.findFirst({ where: { id, shopId } });
      return NextResponse.json(updated);
    }
    const customerUpdate = { ...body };
    delete customerUpdate.action;
    const balanceStatus =
      customerUpdate.outstandingBalance === undefined
        ? undefined
        : customerUpdate.outstandingBalance <= 0
          ? "CLEARED"
          : customerUpdate.status === "CLEARED"
            ? "PENDING"
            : customerUpdate.status;
    const data = {
      ...customerUpdate,
      contactNumber: customerUpdate.contactNumber ? normalizePhone(customerUpdate.contactNumber) : undefined,
      status: balanceStatus ?? customerUpdate.status,
      nextFollowupDate:
        customerUpdate.outstandingBalance !== undefined && customerUpdate.outstandingBalance <= 0
          ? null
          : customerUpdate.nextFollowupDate === null
          ? null
          : customerUpdate.nextFollowupDate
            ? new Date(customerUpdate.nextFollowupDate)
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
  const customer = await prisma.customer.updateMany({
    where: { id, shopId },
    data: { isArchived: true, archivedAt: new Date(), archivedById: session.id, nextFollowupDate: null },
  });
  if (!customer.count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logActivity({ action: "customer_archived", userId: session.id, shopId, customerId: id });
  return NextResponse.json({ ok: true, action: "archived" });
}
