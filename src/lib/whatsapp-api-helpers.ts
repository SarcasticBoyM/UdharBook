import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { isShopAdminRole } from "@/lib/operational-roles";

export function forbiddenWhatsAppResponse() {
  return NextResponse.json({ error: "Only Shop Admin can manage WhatsApp order notifications." }, { status: 403 });
}

export async function requireWhatsAppAdminShop(request: Request) {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!isShopAdminRole(session.role)) return { response: forbiddenWhatsAppResponse() };
  return { session, shopId: requireShopId(request, session) };
}

export async function whatsappSettingFor(shopId: string) {
  return prisma.whatsAppOrderNotificationSetting.upsert({
    where: { shopId },
    update: {},
    create: { shopId },
  });
}

export async function settingResponse(shopId: string) {
  const setting = await whatsappSettingFor(shopId);
  const qrCodeImage = setting.lastQrCode ? await QRCode.toDataURL(setting.lastQrCode, { margin: 1, width: 240 }) : null;
  const recentJobs = await prisma.whatsAppNotificationJob.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, event: true, status: true, retryCount: true, lastError: true, sentAt: true, createdAt: true, targetGroupName: true },
  });

  return NextResponse.json({ setting: { ...setting, qrCodeImage }, recentJobs });
}
