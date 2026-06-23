import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { normalizePhone } from "@/lib/phone";
import { canUseOrders } from "@/lib/permissions";

const publicOrderSchema = z.object({
  customerName: z.string().trim().min(1, "Customer name is required.").max(120),
  mobile: z.string().trim().min(1, "Mobile number is required.").max(30),
  address: z.string().trim().max(300).optional().nullable(),
  orderText: z.string().trim().min(1, "Order details are required.").max(4000),
  deliveryDate: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
});

function parseDeliveryDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00+05:30`);
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_DELIVERY_DATE");
  return parsed;
}

function normalizeIndianMobile(input: unknown) {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

async function findMobileMatches(shopId: string, normalizedMobile: string) {
  const candidates = await prisma.customer.findMany({
    where: { shopId, isArchived: false },
    select: { id: true, partyName: true, contactNumber: true, batchTag: true },
    take: 2000,
  });
  return candidates.filter((customer) => normalizeIndianMobile(customer.contactNumber) === normalizedMobile);
}

async function notifyPublicOrderSafe(input: {
  shopId: string;
  orderId: string;
  customerName: string;
}) {
  try {
    await prisma.notification.create({
      data: {
        shopId: input.shopId,
        targetType: "SHOP",
        type: "ORDER_CREATED",
        title: "New order received",
        message: `${input.customerName} placed an order from customer order link.`,
        entityType: "ORDER",
        entityId: input.orderId,
        actionUrl: "/orders",
        priority: "NORMAL",
        idempotencyKey: `public-order:${input.orderId}`,
      },
    });
  } catch (error) {
    logger.error("public_order_notification_failed_non_blocking", {
      shopId: input.shopId,
      orderId: input.orderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const requestId = crypto.randomUUID();
  const { token } = await params;
  try {
    const link = await prisma.orderPublicLink.findUnique({
      where: { token },
      select: { shopId: true, isEnabled: true },
    });
    if (!link) return NextResponse.json({ success: false, error: "This order link is invalid." }, { status: 404 });
    if (!link.isEnabled) {
      return NextResponse.json({ success: false, error: "This order link is currently disabled." }, { status: 403 });
    }

    const payload = publicOrderSchema.parse(await request.json());
    if (payload.website) {
      return NextResponse.json({ success: false, error: "Could not submit order." }, { status: 400 });
    }

    const customerName = payload.customerName.replace(/\s+/g, " ");
    const mobile = normalizeIndianMobile(payload.mobile);
    const storedMobile = normalizePhone(payload.mobile);
    if (!mobile || mobile.length < 6) {
      return NextResponse.json({ success: false, error: "Enter a valid mobile number." }, { status: 400 });
    }
    const deliveryDate = parseDeliveryDate(payload.deliveryDate);
    const duplicateWindowStart = new Date(Date.now() - 60_000);
    const orderOwner = await prisma.user.findFirst({
      where: {
        shopId: link.shopId,
        disabledAt: null,
        role: { in: ["SHOP_ADMIN", "SALES_PERSON_CUM_ACCOUNTS", "ACCOUNT_STAFF", "SALES_PERSON"] as UserRole[] },
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: { id: true, role: true },
    });
    if (!orderOwner || !canUseOrders(orderOwner.role)) {
      return NextResponse.json({ success: false, error: "This shop cannot receive public orders right now." }, { status: 503 });
    }

    const matches = await findMobileMatches(link.shopId, mobile);
    const duplicateOrder = await prisma.order.findFirst({
      where: {
        shopId: link.shopId,
        orderDetails: payload.orderText,
        createdAt: { gte: duplicateWindowStart },
        OR: [
          { submittedCustomerMobile: mobile },
          { customer: { contactNumber: { contains: mobile } } },
        ],
      },
      select: { id: true },
    });
    if (duplicateOrder) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        message: "Order submitted successfully",
      });
    }

    const order = await prisma.$transaction(async (tx) => {
      let customer: { id: string } | null = null;
      let customerMatchStatus = "REVIEW_REQUIRED";
      let sourceNote = "Customer Order Link - Review required";
      if (matches.length === 1) {
        customer = { id: matches[0].id };
        customerMatchStatus = "AUTO_MATCHED";
        sourceNote = "Customer Order Link - Auto matched";
      } else if (matches.length === 0) {
        customer = await tx.customer.create({
          data: {
            shopId: link.shopId,
            partyName: customerName,
            contactNumber: storedMobile || mobile,
            outstandingBalance: 0,
            status: "PENDING",
            geoAddress: payload.address || undefined,
            notes: "Source: Customer Order Link",
          },
          select: { id: true },
        });
        customerMatchStatus = "NEW_CREATED";
        sourceNote = "Customer Order Link - New customer created";
      }

      const created = await tx.order.create({
        data: {
          shopId: link.shopId,
          customerId: customer?.id,
          createdById: orderOwner.id,
          orderDetails: payload.orderText,
          preferredDeliveryDate: deliveryDate,
          priority: "Normal",
          status: "ORDER_RECEIVED",
          sourceModule: "PUBLIC_ORDER_LINK",
          visitSource: "Customer Order Link",
          customerMatchStatus,
          submittedCustomerName: customerName,
          submittedCustomerMobile: mobile,
          submittedAddress: payload.address || undefined,
        } satisfies Prisma.OrderUncheckedCreateInput,
        select: { id: true },
      });

      await tx.activityLog.create({
        data: {
          shopId: link.shopId,
          userId: orderOwner.id,
          customerId: customer?.id,
          action: "order_created",
          details: sourceNote,
        },
      });

      await tx.orderActivity.create({
        data: {
          shopId: link.shopId,
          orderId: created.id,
          userId: orderOwner.id,
          action: "CREATED",
          newStatus: "ORDER_RECEIVED",
          notes: sourceNote,
        },
      });

      return created;
    });

    await notifyPublicOrderSafe({ shopId: link.shopId, orderId: order.id, customerName });
    logger.info("public_order_created", { requestId, shopId: link.shopId, orderId: order.id });
    return NextResponse.json({
      success: true,
      message: "Order submitted successfully",
      summary: {
        customerName,
        mobile,
        orderText: payload.orderText,
        deliveryDate: payload.deliveryDate || null,
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues[0]?.message ?? "Invalid order details."
      : error instanceof Error && error.message === "INVALID_DELIVERY_DATE"
        ? "Delivery date is invalid."
        : "Could not submit order.";
    logger.error("public_order_create_failed", {
      requestId,
      token,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
