import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import {
  createReceiptSignedUrl,
  receiptPath,
  receiptStorageConfigured,
  uploadDepositReceipt,
} from "@/lib/storage/deposit-receipts";
import { canUseCheques } from "@/lib/permissions";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseCheques(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!receiptStorageConfigured()) {
    return NextResponse.json({ error: "Receipt storage is not configured" }, { status: 500 });
  }

  const { id } = await params;
  const shopId = requireShopId(request, session);
  const cheque = await prisma.cheque.findFirst({ where: { id, shopId }, select: { id: true } });
  if (!cheque) return NextResponse.json({ error: "Cheque not found" }, { status: 404 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No receipt file uploaded" }, { status: 400 });
  if (!allowedTypes.has(file.type)) return NextResponse.json({ error: "Only JPG, PNG, WEBP, or PDF receipts allowed" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "Receipt must be under 8 MB" }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const path = receiptPath(shopId, id, file.name || `receipt.${file.type === "application/pdf" ? "pdf" : "jpg"}`);
  await uploadDepositReceipt({ path, file: bytes, contentType: file.type });

  return NextResponse.json({
    url: path,
    type: file.type,
    uploadedAt: new Date().toISOString(),
    uploadedBy: session.id,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const shopId = requireShopId(request, session);
  const cheque = await prisma.cheque.findFirst({
    where: { id, shopId },
    select: { depositReceiptUrl: true },
  });
  if (!cheque?.depositReceiptUrl) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

  const signedUrl = await createReceiptSignedUrl(cheque.depositReceiptUrl);
  return NextResponse.redirect(signedUrl);
}
