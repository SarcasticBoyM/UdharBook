import { NextResponse } from "next/server";
import { requireWhatsAppAdminShop } from "@/lib/whatsapp-api-helpers";
import { logoutWhatsAppSession } from "@/lib/whatsapp-baileys";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireWhatsAppAdminShop(request);
  if (auth.response) return auth.response;

  await logoutWhatsAppSession(auth.shopId);
  return NextResponse.json({ success: true });
}
