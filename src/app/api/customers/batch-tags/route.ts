import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { normalizeBatchTag } from "@/lib/batch-tags";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const shopId = requireShopId(request, session);
  const rows = await prisma.customer.findMany({
    where: { shopId, batchTag: { not: null } },
    select: { batchTag: true },
    distinct: ["batchTag"],
    orderBy: { batchTag: "asc" },
    take: 200,
  });

  const tags = Array.from(
    new Set(rows.map((row) => normalizeBatchTag(row.batchTag)).filter((tag): tag is string => Boolean(tag)))
  ).sort((a, b) => a.localeCompare(b));

  return NextResponse.json({ tags });
}
