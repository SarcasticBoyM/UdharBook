import { requireWhatsAppAdminShop, settingResponse } from "@/lib/whatsapp-api-helpers";
import { startWhatsAppSession } from "@/lib/whatsapp-baileys";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireWhatsAppAdminShop(request);
  if (auth.response) return auth.response;

  await startWhatsAppSession(auth.shopId);
  return settingResponse(auth.shopId);
}
