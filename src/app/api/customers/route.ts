import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canDelete } from "@/lib/permissions";
import { normalizePhone } from "@/lib/phone";
import { requireShopId } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";

const createSchema = z.object({
  partyName: z.string().min(1),
  contactNumber: z.string().min(1),
  outstandingBalance: z.number().min(0).default(0),
  notes: z.string().optional(),
  nextFollowupDate: z.string().datetime().optional().nullable(),
  status: z.enum(["ACTIVE", "PENDING", "HIGH_RISK", "CLEARED"]).optional(),
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") ?? "";
  const status = searchParams.get("status");
  const view = searchParams.get("view") ?? "all";
  const sort = searchParams.get("sort") ?? "balance";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 20)));
  const skip = (page - 1) * limit;
  const shopId = requireShopId(request, session);
  const phoneSearch = search.replace(/\D/g, "");
  const searchOr: Prisma.CustomerWhereInput[] = search
    ? [
        { partyName: { contains: search } },
        ...(phoneSearch ? [{ contactNumber: { contains: phoneSearch } }] : []),
      ]
    : [];

  const where: Prisma.CustomerWhereInput = {
    shopId,
    ...(status ? { status: status as Prisma.EnumCustomerStatusFilter["equals"] } : {}),
    ...(searchOr.length ? { OR: searchOr } : {}),
    ...(view === "pending"
      ? {
          outstandingBalance: { gt: 0 },
          NOT: { status: "CLEARED" },
        }
      : {}),
  };

  const orderBy: Prisma.CustomerOrderByWithRelationInput =
    sort === "nextFollowup"
      ? { nextFollowupDate: order }
      : { outstandingBalance: order };

  const [items, total] = await Promise.all([
    prisma.customer.findMany({ where, orderBy, skip, take: limit }),
    prisma.customer.count({ where }),
  ]);

  return NextResponse.json({
    items,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "FIELD_SALES") {
    return NextResponse.json({ error: "Field sales users can create leads from the field visit workflow" }, { status: 403 });
  }

  try {
    const body = createSchema.parse(await request.json());
    const contactNumber = normalizePhone(body.contactNumber);
    const shopId = requireShopId(request, session);

    const customer = await prisma.customer.create({
      data: {
        shopId,
        partyName: body.partyName,
        contactNumber,
        outstandingBalance: body.outstandingBalance,
        notes: body.notes,
        nextFollowupDate: body.nextFollowupDate ? new Date(body.nextFollowupDate) : null,
        status: body.status ?? (body.outstandingBalance === 0 ? "CLEARED" : "PENDING"),
      },
    });

    await logActivity({
      action: "customer_created",
      userId: session.id,
      shopId,
      customerId: customer.id,
      details: customer.partyName,
    });

    return NextResponse.json(customer, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "Contact number already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canDelete(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const shopId = requireShopId(request, session);
  await prisma.customer.deleteMany({ where: { id, shopId } });
  return NextResponse.json({ ok: true });
}
