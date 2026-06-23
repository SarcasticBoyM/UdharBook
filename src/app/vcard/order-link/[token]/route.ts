import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await prisma.orderPublicLink.findUnique({
    where: { token },
    select: {
      isEnabled: true,
      shop: { select: { shopName: true } },
    },
  });

  if (!link) {
    return NextResponse.json({ success: false, error: "This order link is invalid." }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    shopName: link.shop.shopName,
    isEnabled: link.isEnabled,
  });
}
