import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isSuperAdmin, resolveOperationalShopId, visibleShops } from "@/lib/tenant";

const schema = z.object({
  shopName: z.string().min(1),
  ownerName: z.string().min(1),
  email: z.string().email().optional(),
  gstNumber: z.string().optional(),
  mobile: z.string().optional(),
  address: z.string().optional(),
  subscriptionStatus: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"]).default("TRIAL"),
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const shops = await visibleShops(session);
  const selectedShopId = await resolveOperationalShopId(request, session).catch(() => shops[0]?.id ?? session.shopId);
  return NextResponse.json({ shops, selectedShopId });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = schema.parse(await request.json());
    const shop = await prisma.shop.create({ data: body });
    return NextResponse.json(shop, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
