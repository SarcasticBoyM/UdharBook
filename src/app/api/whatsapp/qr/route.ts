import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { requireWhatsAppAdminShop, whatsappSettingFor } from "@/lib/whatsapp-api-helpers";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireWhatsAppAdminShop(request);
  if (auth.response) return auth.response;

  const setting = await whatsappSettingFor(auth.shopId);
  const qrCodeImage = setting.lastQrCode ? await QRCode.toDataURL(setting.lastQrCode, { margin: 1, width: 240 }) : null;
  return NextResponse.json({
    success: true,
    connectionStatus: setting.connectionStatus,
    qrCode: setting.lastQrCode,
    qrCodeImage,
  });
}
