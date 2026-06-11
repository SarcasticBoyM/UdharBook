import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireWhatsAppAdminShop, whatsappSettingFor } from "@/lib/whatsapp-api-helpers";
import { sendWhatsAppGroupMessage } from "@/lib/whatsapp-baileys";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireWhatsAppAdminShop(request);
  if (auth.response) return auth.response;

  const setting = await whatsappSettingFor(auth.shopId);
  if (!setting.groupJid) return NextResponse.json({ error: "Select a WhatsApp group first." }, { status: 400 });

  await sendWhatsAppGroupMessage(auth.shopId, setting.groupJid, `UdharBook test notification\n\nOrder Desk group notifications are connected for ${setting.groupName ?? "this group"}.`);
  await prisma.whatsAppOrderNotificationSetting.update({
    where: { shopId: auth.shopId },
    data: { lastTestSentAt: new Date(), lastError: null },
  });
  return NextResponse.json({ success: true });
}
