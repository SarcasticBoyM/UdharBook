import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canDelete, canManageCustomers } from "@/lib/permissions";
import { normalizePhone } from "@/lib/phone";
import { requireShopId } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { notifyCustomerAdded } from "@/lib/notifications";

const createSchema = z.object({
  partyName: z.string().min(1),
  contactNumber: z.string().min(1),
  outstandingBalance: z.number().min(0).default(0),
  notes: z.string().optional(),
  nextFollowupDate: z.string().datetime().optional().nullable(),
  status: z.enum(["ACTIVE", "PENDING", "HIGH_RISK", "CLEARED"]).optional(),
});

const bulkArchiveSchema = z.object({
  action: z.enum(["archive", "restore"]),
  ids: z.array(z.string().min(1)).min(1).max(500),
});

function normalizeSearch(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function textContains(field: "partyName" | "geoAddress", value: string): Prisma.CustomerWhereInput {
  return { [field]: { contains: value, mode: "insensitive" } };
}

function textContainsAllTerms(field: "partyName" | "geoAddress", terms: string[]): Prisma.CustomerWhereInput {
  return { AND: terms.map((term) => textContains(field, term)) };
}

function activeCustomerWhere(): Prisma.CustomerWhereInput {
  return { outstandingBalance: { gt: 0 }, NOT: { status: "CLEARED" } };
}

function inactiveCustomerWhere(): Prisma.CustomerWhereInput {
  return {
    AND: [
      {
        OR: [
          { outstandingBalance: { lte: 0 } },
          { status: "CLEARED" },
        ],
      },
    ],
  };
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = normalizeSearch(searchParams.get("search") ?? "");
  const status = searchParams.get("status");
  const batchTag = searchParams.get("batchTag")?.trim();
  const view = searchParams.get("view") ?? "all";
  const includeArchived = searchParams.get("includeArchived") === "true" || view === "all_with_archived";
  const sort = searchParams.get("sort") ?? "balance";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 20)));
  const skip = (page - 1) * limit;
  const shopId = requireShopId(request, session);
  const phoneSearch = search.replace(/\D/g, "");
  const searchTerms = search.split(" ").filter(Boolean);
  const searchOr: Prisma.CustomerWhereInput[] = search
    ? [
        textContains("partyName", search),
        textContains("geoAddress", search),
        ...(searchTerms.length > 1
          ? [
              textContainsAllTerms("partyName", searchTerms),
              textContainsAllTerms("geoAddress", searchTerms),
            ]
          : []),
        ...(phoneSearch ? [{ contactNumber: { contains: phoneSearch } }] : []),
        { batchTag: { contains: search, mode: "insensitive" } },
      ]
    : [];

  const where: Prisma.CustomerWhereInput = {
    shopId,
    ...(view === "archived" ? { isArchived: true } : includeArchived ? {} : { isArchived: false }),
    ...(batchTag ? { batchTag: { equals: batchTag, mode: "insensitive" } } : {}),
    ...(status ? { status: status as Prisma.EnumCustomerStatusFilter["equals"] } : {}),
    ...(searchOr.length ? { OR: searchOr } : {}),
    ...(view === "active" || view === "pending" ? activeCustomerWhere() : {}),
    ...(view === "inactive" ? inactiveCustomerWhere() : {}),
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
  if (!canManageCustomers(session.role)) {
    return NextResponse.json({ error: "Sales Person users can create leads from the field visit workflow" }, { status: 403 });
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
        status: body.outstandingBalance <= 0 ? "CLEARED" : body.status === "CLEARED" ? "PENDING" : body.status ?? "PENDING",
      },
    });

    await logActivity({
      action: "customer_created",
      userId: session.id,
      shopId,
      customerId: customer.id,
      details: customer.partyName,
    });

    await notifyCustomerAdded({
      shopId,
      customerId: customer.id,
      customerName: customer.partyName,
      createdByName: session.name,
    });

    return NextResponse.json(customer, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "Contact number already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageCustomers(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = bulkArchiveSchema.parse(await request.json());
    const shopId = requireShopId(request, session);
    const result = await prisma.customer.updateMany({
      where: { id: { in: body.ids }, shopId },
      data:
        body.action === "archive"
          ? { isArchived: true, archivedAt: new Date(), archivedById: session.id, nextFollowupDate: null }
          : { isArchived: false, archivedAt: null, archivedById: null },
    });

    await logActivity({
      action: body.action === "archive" ? "customers_bulk_archived" : "customers_bulk_restored",
      userId: session.id,
      shopId,
      details: `${result.count} customer${result.count === 1 ? "" : "s"}`,
    });

    return NextResponse.json({ ok: true, action: body.action, count: result.count });
  } catch {
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
  const customer = await prisma.customer.updateMany({
    where: { id, shopId },
    data: { isArchived: true, archivedAt: new Date(), archivedById: session.id, nextFollowupDate: null },
  });
  if (!customer.count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logActivity({ action: "customer_archived", userId: session.id, shopId, customerId: id });
  return NextResponse.json({ ok: true, action: "archived" });
}
