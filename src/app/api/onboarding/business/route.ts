import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/tenant";
import { generateTemporaryPassword } from "@/lib/password";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";

const schema = z.object({
  shopName: z.string().min(1),
  ownerName: z.string().min(1),
  mobile: z.string().optional(),
  email: z.string().email(),
  gstNumber: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  businessType: z.string().optional(),
  logoUrl: z.string().optional(),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  adminMobile: z.string().optional(),
  adminPassword: z.string().min(8).optional(),
  onboardingMode: z.boolean().optional(),
  preferences: z
    .object({
      remindersEnabled: z.boolean().optional(),
      defaultFollowupTiming: z.string().optional(),
      chequeModuleEnabled: z.boolean().optional(),
      fieldStaffTrackingEnabled: z.boolean().optional(),
      whatsappShortcutsEnabled: z.boolean().optional(),
      highAmountThreshold: z.number().min(0).optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = schema.parse(await request.json());
    const temporaryPassword = body.adminPassword ?? generateTemporaryPassword();
    const result = await prisma.$transaction(async (tx) => {
      const shop = await tx.shop.create({
        data: {
          shopName: body.shopName,
          ownerName: body.ownerName,
          mobile: body.mobile,
          email: body.email,
          gstNumber: body.gstNumber,
          address: body.address,
          city: body.city,
          businessType: body.businessType,
          logoUrl: body.logoUrl,
          onboardingCompleted: body.onboardingMode ? false : true,
          setupStep: body.onboardingMode ? "import_customers" : "complete",
          recoveryPreferences: body.preferences,
          subscriptionStatus: "TRIAL",
        },
      });
      const user = await tx.user.create({
        data: {
          name: body.adminName,
          email: body.adminEmail.toLowerCase(),
          mobile: body.adminMobile,
          passwordHash: await hashPassword(temporaryPassword),
          role: "SHOP_ADMIN",
          shopId: shop.id,
          passwordResetRequired: !body.adminPassword,
          tempPasswordExpiresAt: body.adminPassword ? null : new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        select: { id: true, name: true, email: true, role: true, shopId: true },
      });
      return { shop, user };
    });

    await prisma.userRoleAssignment.create({
      data: {
        shopId: result.shop.id,
        userId: result.user.id,
        role: "SHOP_ADMIN",
        assignedById: session.id,
      },
    }).catch((error) => {
      logger.error("onboard_shop_admin_role_assignment_failed_non_blocking", {
        actorId: session.id,
        shopId: result.shop.id,
        userId: result.user.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });

    await logActivity({
      action: "business_onboarded",
      userId: session.id,
      shopId: result.shop.id,
      details: result.shop.shopName,
    });

    const response = NextResponse.json({ ...result, temporaryPassword }, { status: 201 });
    response.cookies.set("udharbook_shop", result.shop.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
