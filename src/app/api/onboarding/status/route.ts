import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getOnboardingState } from "@/lib/onboarding";
import { isSuperAdmin } from "@/lib/tenant";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const state = await getOnboardingState(session);
  const [staffCount, customerCount] = state.activeShopId
    ? await Promise.all([
        prisma.user.count({ where: { shopId: state.activeShopId, role: { not: "SUPER_ADMIN" } } }),
        prisma.customer.count({ where: { shopId: state.activeShopId } }),
      ])
    : [0, 0];

  return NextResponse.json({ ...state, staffCount, customerCount });
}
