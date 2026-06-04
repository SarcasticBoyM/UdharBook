import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";

type CustomerSearchRow = {
  id: string;
  partyName: string;
  contactNumber: string;
  outstandingBalance: number;
  lastFollowupDate: Date | null;
  nextFollowupDate: Date | null;
  staffVisits: { checkInAt: Date }[];
};

function compact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function scoreCustomer(customer: CustomerSearchRow, query: string) {
  const name = compact(customer.partyName);
  const phone = customer.contactNumber.replace(/\D/g, "");
  const q = compact(query);
  const phoneQ = query.replace(/\D/g, "");

  if (!q && !phoneQ) return 0;
  if (name === q) return 1000;
  if (name.startsWith(q)) return 900;
  if (name.includes(q)) return 750;
  if (phoneQ && phone.startsWith(phoneQ)) return 850;
  if (phoneQ && phone.includes(phoneQ)) return 700;

  const queryParts = q.match(/[a-z0-9]+/g) ?? [];
  const matchedParts = queryParts.filter((part) => part.length > 1 && name.includes(part)).length;
  return matchedParts ? 500 + matchedParts * 25 : 0;
}

function serializeCustomer(customer: CustomerSearchRow, query: string) {
  return {
    id: customer.id,
    partyName: customer.partyName,
    contactNumber: customer.contactNumber,
    outstandingBalance: customer.outstandingBalance,
    lastFollowupDate: customer.lastFollowupDate,
    nextFollowupDate: customer.nextFollowupDate,
    lastVisitDate: customer.staffVisits[0]?.checkInAt ?? null,
    matchScore: scoreCustomer(customer, query),
  };
}

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: true, customers: [], error: "Unauthorized" }, { status: 200 });
    }

    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") ?? searchParams.get("search") ?? "").trim();
    const limit = Math.min(10, Math.max(1, Number(searchParams.get("limit") ?? 10)));
    const shopId = requireShopId(request, session);
    const phoneQuery = query.replace(/\D/g, "");

    const where: Prisma.CustomerWhereInput = {
      shopId,
      ...(query
        ? {
            OR: [
              { partyName: { contains: query, mode: "insensitive" } },
              ...(phoneQuery ? [{ contactNumber: { contains: phoneQuery } }] : []),
            ],
          }
        : {}),
    };

    const rows = await prisma.customer.findMany({
      where,
      select: {
        id: true,
        partyName: true,
        contactNumber: true,
        outstandingBalance: true,
        lastFollowupDate: true,
        nextFollowupDate: true,
        staffVisits: {
          orderBy: { checkInAt: "desc" },
          take: 1,
          select: { checkInAt: true },
        },
      },
      orderBy: query ? [{ outstandingBalance: "desc" }, { partyName: "asc" }] : [{ updatedAt: "desc" }],
      take: query ? 40 : limit,
    });

    const customers = rows
      .map((customer) => serializeCustomer(customer, query))
      .filter((customer) => !query || customer.matchScore > 0 || customer.partyName.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.matchScore - a.matchScore || b.outstandingBalance - a.outstandingBalance)
      .slice(0, limit);

    return NextResponse.json({ success: true, customers });
  } catch (error) {
    console.error("Customer search failed", error);
    return NextResponse.json({ success: true, customers: [], error: "Search temporarily unavailable" }, { status: 200 });
  }
}
