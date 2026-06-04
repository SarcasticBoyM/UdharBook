import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canManageShop, requireShopId } from "@/lib/tenant";

const updateSchema = z.object({
  accountName: z.string().min(1).optional(),
  bankName: z.string().min(1).optional(),
  lastFourDigits: z.string().regex(/^\d{4}$/).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageShop(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = requireShopId(request, session);
  const { id } = await params;
  const body = updateSchema.parse(await request.json());

  const existing = await prisma.chequeDepositAccount.findFirst({ where: { id, shopId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const account = await prisma.chequeDepositAccount.update({ where: { id }, data: body });
  return NextResponse.json(account);
}
