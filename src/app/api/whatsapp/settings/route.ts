import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ORDER_WHATSAPP_EVENTS } from "@/lib/whatsapp-order-notifications";
import { requireWhatsAppAdminShop, settingResponse } from "@/lib/whatsapp-api-helpers";

export const runtime = "nodejs";

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  groupJid: z.string().min(1).nullable().optional(),
  groupName: z.string().min(1).nullable().optional(),
  selectedEvents: z.array(z.enum(ORDER_WHATSAPP_EVENTS)).optional(),
});

export async function GET(request: Request) {
  const auth = await requireWhatsAppAdminShop(request);
  if (auth.response) return auth.response;
  return settingResponse(auth.shopId);
}

export async function PATCH(request: Request) {
  const auth = await requireWhatsAppAdminShop(request);
  if (auth.response) return auth.response;

  const body = updateSchema.parse(await request.json());
  const setting = await prisma.whatsAppOrderNotificationSetting.upsert({
    where: { shopId: auth.shopId },
    update: {
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.groupJid !== undefined ? { groupJid: body.groupJid } : {}),
      ...(body.groupName !== undefined ? { groupName: body.groupName } : {}),
      ...(body.selectedEvents ? { selectedEvents: body.selectedEvents } : {}),
    },
    create: {
      shopId: auth.shopId,
      enabled: body.enabled ?? false,
      groupJid: body.groupJid ?? null,
      groupName: body.groupName ?? null,
      selectedEvents: body.selectedEvents ?? [...ORDER_WHATSAPP_EVENTS],
    },
  });
  return NextResponse.json({ setting });
}
