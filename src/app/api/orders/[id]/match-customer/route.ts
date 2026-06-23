import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { canUseOrders } from "@/lib/permissions";
import { requireShopId } from "@/lib/tenant";

const matchSchema = z.object({
  action: z.enum(["LINK_EXISTING", "CREATE_NEW", "KEEP_UNLINKED"]),
  customerId: z.string().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!canUseOrders(session.role)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

  const shopId = requireShopId(request, session);
  const { id } = await params;
  try {
    const body = matchSchema.parse(await request.json());
    const order = await prisma.order.findFirst({
      where: { id, shopId },
      select: {
        id: true,
        submittedCustomerName: true,
        submittedCustomerMobile: true,
        submittedAddress: true,
      },
    });
    if (!order) return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });

    let customerId: string | null = null;
    let customerMatchStatus = "UNLINKED";
    if (body.action === "LINK_EXISTING") {
      if (!body.customerId) return NextResponse.json({ success: false, error: "Select a customer." }, { status: 400 });
      const customer = await prisma.customer.findFirst({
        where: { id: body.customerId, shopId, isArchived: false },
        select: { id: true },
      });
      if (!customer) return NextResponse.json({ success: false, error: "Customer not found for this shop." }, { status: 404 });
      customerId = customer.id;
      customerMatchStatus = "AUTO_MATCHED";
    }

    if (body.action === "CREATE_NEW") {
      if (!order.submittedCustomerName || !order.submittedCustomerMobile) {
        return NextResponse.json({ success: false, error: "Submitted customer details are missing." }, { status: 400 });
      }
      const customer = await prisma.customer.create({
        data: {
          shopId,
          partyName: order.submittedCustomerName,
          contactNumber: normalizePhone(order.submittedCustomerMobile),
          outstandingBalance: 0,
          status: "PENDING",
          geoAddress: order.submittedAddress || undefined,
          notes: "Source: Customer Order Link review",
        },
        select: { id: true },
      });
      customerId = customer.id;
      customerMatchStatus = "NEW_CREATED";
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { customerId, customerMatchStatus },
      include: {
        customer: { select: { id: true, partyName: true, contactNumber: true, batchTag: true } },
        createdBy: { select: { name: true } },
        activities: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { user: { select: { name: true } } },
        },
      },
    });

    return NextResponse.json({ success: true, order: updated });
  } catch (error) {
    const message = error instanceof z.ZodError ? "Invalid match action." : "Could not match customer.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
