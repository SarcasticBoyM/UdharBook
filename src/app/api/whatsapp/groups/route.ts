import { NextResponse } from "next/server";
import { requireWhatsAppAdminShop } from "@/lib/whatsapp-api-helpers";
import { getWhatsAppGroups } from "@/lib/whatsapp-baileys";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireWhatsAppAdminShop(request);
  if (auth.response) return auth.response;

  const groups = await getWhatsAppGroups(auth.shopId);
  return NextResponse.json({ groups });
}
