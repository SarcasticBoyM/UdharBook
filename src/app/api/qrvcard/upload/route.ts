import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { qrvcardStorageConfigured, uploadQRVCardAsset } from "@/lib/storage/qrvcard-assets";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const kindSchema = z.enum(["logo", "banner", "gallery"]);

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "SHOP_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!qrvcardStorageConfigured()) return NextResponse.json({ error: "QRVCard storage is not configured" }, { status: 500 });

  const shopId = requireShopId(request, session);
  const formData = await request.formData();
  const file = formData.get("file");
  const kind = kindSchema.parse(formData.get("kind") ?? "gallery");
  if (!(file instanceof File)) return NextResponse.json({ error: "No image uploaded" }, { status: 400 });
  if (!allowedTypes.has(file.type)) return NextResponse.json({ error: "Only JPG, PNG, or WEBP images allowed" }, { status: 400 });
  if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "Image must be under 4 MB" }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const url = await uploadQRVCardAsset({
    shopId,
    kind,
    file: bytes,
    fileName: file.name || `${kind}.jpg`,
    contentType: file.type,
  });
  return NextResponse.json({ url });
}
