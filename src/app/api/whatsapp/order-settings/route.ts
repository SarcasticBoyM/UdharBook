import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { isShopAdminRole } from "@/lib/operational-roles";
import { ORDER_WHATSAPP_EVENTS } from "@/lib/whatsapp-order-notifications";
import { getWhatsAppGroups, logoutWhatsAppSession, sendWhatsAppGroupMessage, startWhatsAppSession } from "@/lib/whatsapp-baileys";

export const runtime = "nodejs";

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  groupJid: z.string().min(1).nullable().optional(),
  groupName: z.string().min(1).nullable().optional(),
  selectedEvents: z.array(z.enum(ORDER_WHATSAPP_EVENTS)).optional(),
});

const actionSchema = z.object({
  action: z.enum(["CONNECT", "GROUPS", "TEST", "LOGOUT"]),
});

function forbidden() {
  return NextResponse.json({ error: "Only Shop Admin can manage WhatsApp order notifications." }, { status: 403 });
}

async function requireAdminShop(request: Request) {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!isShopAdminRole(session.role)) return { response: forbidden() };
  return { session, shopId: requireShopId(request, session) };
}

async function settingFor(shopId: string) {
  return prisma.whatsAppOrderNotificationSetting.upsert({
    where: { shopId },
    update: {},
    create: { shopId },
  });
}

export async function GET(request: Request) {
  const auth = await requireAdminShop(request);
  if (auth.response) return auth.response;

  const setting = await settingFor(auth.shopId);
  const qrCodeImage = setting.lastQrCode ? await QRCode.toDataURL(setting.lastQrCode, { margin: 1, width: 240 }) : null;
  const recentJobs = await prisma.whatsAppNotificationJob.findMany({
    where: { shopId: auth.shopId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, event: true, status: true, retryCount: true, lastError: true, sentAt: true, createdAt: true, targetGroupName: true },
  });

  return NextResponse.json({ setting: { ...setting, qrCodeImage }, recentJobs });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminShop(request);
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

export async function POST(request: Request) {
  const auth = await requireAdminShop(request);
  if (auth.response) return auth.response;

  const body = actionSchema.parse(await request.json());

  if (body.action === "CONNECT") {
    await startWhatsAppSession(auth.shopId);
    const setting = await settingFor(auth.shopId);
    const qrCodeImage = setting.lastQrCode ? await QRCode.toDataURL(setting.lastQrCode, { margin: 1, width: 240 }) : null;
    return NextResponse.json({ setting: { ...setting, qrCodeImage } });
  }

  if (body.action === "GROUPS") {
    const groups = await getWhatsAppGroups(auth.shopId);
    return NextResponse.json({ groups });
  }

  if (body.action === "TEST") {
    const setting = await settingFor(auth.shopId);
    if (!setting.groupJid) return NextResponse.json({ error: "Select a WhatsApp group first." }, { status: 400 });
    await sendWhatsAppGroupMessage(auth.shopId, setting.groupJid, `✅ UdharBook test notification\n\nOrder Desk group notifications are connected for ${setting.groupName ?? "this group"}.`);
    await prisma.whatsAppOrderNotificationSetting.update({
      where: { shopId: auth.shopId },
      data: { lastTestSentAt: new Date(), lastError: null },
    });
    return NextResponse.json({ ok: true });
  }

  await logoutWhatsAppSession(auth.shopId);
  return NextResponse.json({ ok: true });
}
