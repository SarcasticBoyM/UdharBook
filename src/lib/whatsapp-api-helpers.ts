import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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

export function isMissingWhatsAppTables(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code);
}

export function missingWhatsAppTablesResponse() {
  return NextResponse.json({
    success: false,
    error: "WhatsApp tables not installed",
  });
}

function whatsappDiagnostics(templates: Prisma.JsonValue | null | undefined) {
  if (!templates || typeof templates !== "object" || Array.isArray(templates)) return {};
  const diagnostics = (templates as Prisma.JsonObject).whatsappDiagnostics;
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return {};
  return diagnostics as Prisma.JsonObject;
}

export async function settingResponse(shopId: string) {
  try {
    const setting = await whatsappSettingFor(shopId);
    const diagnostics = whatsappDiagnostics(setting.templates);
    const qrCodeImage = setting.lastQrCode ? await QRCode.toDataURL(setting.lastQrCode, { margin: 1, width: 240 }) : null;
    const recentJobs = await prisma.whatsAppNotificationJob.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, event: true, status: true, retryCount: true, lastError: true, sentAt: true, createdAt: true, targetGroupName: true },
    });

    return NextResponse.json({
      success: true,
      setting: {
        ...setting,
        qrCodeImage,
        lastDisconnectReason: diagnostics.lastDisconnectReason ?? null,
        lastConnectionState: diagnostics.lastConnectionState ?? setting.connectionStatus,
        lastPairingError: diagnostics.lastPairingError ?? null,
        lastCredsSavedAt: diagnostics.lastCredsSavedAt ?? null,
        lastCredsSaveError: diagnostics.lastCredsSaveError ?? null,
        hasRegisteredCreds: diagnostics.hasRegisteredCreds ?? null,
      },
      recentJobs,
    });
  } catch (error) {
    if (isMissingWhatsAppTables(error)) return missingWhatsAppTablesResponse();
    throw error;
  }
}
