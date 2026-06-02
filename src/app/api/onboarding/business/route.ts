import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/tenant";
import { generateTemporaryPassword } from "@/lib/password";
import { logActivity } from "@/lib/activity";

const schema = z.object({
  shopName: z.string().min(1),
  ownerName: z.string().min(1),
  mobile: z.string().optional(),
  email: z.string().email(),
  gstNumber: z.string().optional(),
  address: z.string().optional(),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = schema.parse(await request.json());
    const temporaryPassword = generateTemporaryPassword();
    const result = await prisma.$transaction(async (tx) => {
      const shop = await tx.shop.create({
        data: {
          shopName: body.shopName,
          ownerName: body.ownerName,
          mobile: body.mobile,
          email: body.email,
          gstNumber: body.gstNumber,
          address: body.address,
          subscriptionStatus: "TRIAL",
        },
      });
      const user = await tx.user.create({
        data: {
          name: body.adminName,
          email: body.adminEmail.toLowerCase(),
          passwordHash: await hashPassword(temporaryPassword),
          role: "SHOP_ADMIN",
          shopId: shop.id,
          passwordResetRequired: true,
          tempPasswordExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        select: { id: true, name: true, email: true, role: true, shopId: true },
      });
      return { shop, user };
    });

    await logActivity({
      action: "business_onboarded",
      userId: session.id,
      shopId: result.shop.id,
      details: result.shop.shopName,
    });

    return NextResponse.json({ ...result, temporaryPassword }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique")) {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

