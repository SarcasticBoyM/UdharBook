import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canDelete } from "@/lib/permissions";
import { normalizePhone } from "@/lib/phone";

const updateSchema = z.object({
  partyName: z.string().min(1).optional(),
  contactNumber: z.string().min(1).optional(),
  outstandingBalance: z.number().min(0).optional(),
  notes: z.string().optional().nullable(),
  nextFollowupDate: z.string().datetime().optional().nullable(),
  status: z
    .enum(["ACTIVE", "PENDING", "HIGH_RISK", "CLEARED"])
    .optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const customer = await prisma.customer.findUnique({
    where: { id },
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

    const customer = await prisma.customer.update({ where: { id }, data });
    return NextResponse.json(customer);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canDelete(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  await prisma.customer.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
