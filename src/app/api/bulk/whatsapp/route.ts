import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { paymentReminderMessage, whatsappHref } from "@/lib/whatsapp";
import { requireShopId } from "@/lib/tenant";

const schema = z.object({
  customerIds: z.array(z.string()).min(1),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = schema.parse(await request.json());
    const shopId = requireShopId(request, session);
    const customers = await prisma.customer.findMany({
      where: { shopId, id: { in: body.customerIds } },
    });

    const links = customers.map((c) => ({
      id: c.id,
      partyName: c.partyName,
      url: whatsappHref(
        c.contactNumber,
        paymentReminderMessage(c.partyName, c.outstandingBalance, c.nextFollowupDate)
      ),
    }));

    return NextResponse.json({ links });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
