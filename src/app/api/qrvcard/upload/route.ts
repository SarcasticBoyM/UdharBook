import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import { getQRVCardBucketStatus, qrvcardStorageConfigured, uploadQRVCardAsset } from "@/lib/storage/qrvcard-assets";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const kindSchema = z.enum(["logo", "banner", "gallery"]);

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "SHOP_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!qrvcardStorageConfigured()) {
    logger.error("qrvcard_upload_storage_not_configured", {
      hasSupabaseUrl: Boolean(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    });
    return NextResponse.json({ error: "QRVCard storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  }

  try {
    const shopId = requireShopId(request, session);
    const formData = await request.formData();
    const file = formData.get("file");
    const kind = kindSchema.parse(formData.get("kind") ?? "gallery");
    logger.info("qrvcard_upload_start", {
      shopId,
      userId: session.id,
      kind,
      fileName: file instanceof File ? file.name : null,
      fileType: file instanceof File ? file.type : null,
      fileSize: file instanceof File ? file.size : null,
    });
    if (!(file instanceof File)) return NextResponse.json({ error: "No image uploaded" }, { status: 400 });
    if (!allowedTypes.has(file.type)) return NextResponse.json({ error: "Only JPG, PNG, or WEBP images allowed" }, { status: 400 });
    if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "Image must be under 4 MB" }, { status: 400 });

    const bucketStatus = await getQRVCardBucketStatus(kind);
    logger.info("qrvcard_upload_bucket_status", {
      shopId,
      kind,
      bucket: bucketStatus.bucket,
      exists: bucketStatus.exists,
      isPublic: bucketStatus.isPublic,
      status: bucketStatus.status,
    });
    if (!bucketStatus.exists) {
      return NextResponse.json({ error: `Supabase storage bucket "${bucketStatus.bucket}" was not found. Create it before uploading QRVCard images.` }, { status: 500 });
    }
    if (!bucketStatus.isPublic) {
      return NextResponse.json({ error: `Supabase storage bucket "${bucketStatus.bucket}" is private. Make it public so QRVCard images can load on public cards.` }, { status: 500 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const url = await uploadQRVCardAsset({
      shopId,
      kind,
      file: bytes,
      fileName: file.name || `${kind}.jpg`,
      contentType: file.type,
    });
    logger.info("qrvcard_upload_success", { shopId, userId: session.id, kind, url });
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn("qrvcard_upload_validation_failed", { userId: session.id, issues: error.issues });
      return NextResponse.json({ error: "Invalid upload type. Use logo, banner, or gallery." }, { status: 400 });
    }
    logger.error("qrvcard_upload_failed", {
      userId: session.id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Image upload failed" }, { status: 500 });
  }
}
