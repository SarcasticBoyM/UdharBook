import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveOperationalShopId } from "@/lib/tenant";
import { normalizeFixedRole } from "@/lib/operational-roles";

const presetSchema = z.object({
  productName: z.string().trim().min(1).max(120),
  baseRate: z.number().min(0),
  discountPercent: z.number().min(0).default(0),
  extraDiscountPercent: z.number().min(0).default(0),
  schemeDiscountPercent: z.number().min(0).default(0),
  gstPercent: z.number().min(0).default(0),
  transportLoading: z.number().min(0).default(0),
});

function canManageProductPresets(role: string) {
  const normalized = normalizeFixedRole(role);
  return normalized === "SHOP_ADMIN" || normalized === "SUPER_ADMIN";
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageProductPresets(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    const shopId = await resolveOperationalShopId(request, session);
    const body = presetSchema.parse(await request.json());
    const productName = body.productName.trim().replace(/\s+/g, " ");
    const result = await prisma.productPreset.updateMany({
      where: { id, shopId },
      data: {
        productName,
        baseRate: body.baseRate,
        discountPercent: body.discountPercent,
        extraDiscountPercent: body.extraDiscountPercent,
        schemeDiscountPercent: body.schemeDiscountPercent,
        gstPercent: body.gstPercent,
        transportLoading: body.transportLoading,
      },
    });
    if (!result.count) {
      return NextResponse.json({ error: "Product preset not found" }, { status: 404 });
    }
    const preset = await prisma.productPreset.findFirstOrThrow({ where: { id, shopId } });
    return NextResponse.json({ preset });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid product preset" }, { status: 400 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Product preset not found" }, { status: 404 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Product preset already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not update product preset" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageProductPresets(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    const shopId = await resolveOperationalShopId(request, session);
    const result = await prisma.productPreset.deleteMany({ where: { id, shopId } });
    if (!result.count) {
      return NextResponse.json({ error: "Product preset not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Product preset not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not delete product preset" }, { status: 500 });
  }
}
