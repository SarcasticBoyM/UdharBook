import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canUseOrders } from "@/lib/permissions";
import { requireShopId } from "@/lib/tenant";

function normalizeIndianMobile(input: unknown) {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!canUseOrders(session.role)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

  const shopId = requireShopId(request, session);
  const { id } = await params;
  const order = await prisma.order.findFirst({
    where: { id, shopId },
    select: { id: true, submittedCustomerName: true, submittedCustomerMobile: true, submittedAddress: true },
  });
  if (!order) return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });

  const mobile = normalizeIndianMobile(order.submittedCustomerMobile);
  const candidates = mobile
    ? await prisma.customer.findMany({
        where: { shopId, isArchived: false },
        select: { id: true, partyName: true, contactNumber: true, batchTag: true },
        take: 2000,
      })
    : [];
  const matches = candidates.filter((customer) => normalizeIndianMobile(customer.contactNumber) === mobile);

  return NextResponse.json({
    success: true,
    submitted: {
      customerName: order.submittedCustomerName,
      mobile: order.submittedCustomerMobile,
      address: order.submittedAddress,
    },
    matches,
  });
}
