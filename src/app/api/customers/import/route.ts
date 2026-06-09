import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canImport } from "@/lib/permissions";
import { importCustomersFromExcel } from "@/lib/excel/import";
import { requireShopId } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    logger.info("customer_import_upload_request_start", {
      contentLength: request.headers.get("content-length"),
      contentType: request.headers.get("content-type"),
    });
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canImport(session.role)) {
      return NextResponse.json({ error: "You do not have permission to import customers" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    logger.info("customer_import_upload_file_received", {
      userId: session.id,
      role: session.role,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      durationMs: Date.now() - startedAt,
    });

    const name = file.name.toLowerCase();
    if (!name.endsWith(".xlsx")) {
      return NextResponse.json(
        { error: "Only .xlsx files are allowed (save .xls as .xlsx in Excel)" },
        { status: 400 }
      );
    }

    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: "File too large (max 10 MB). Split the sheet or remove extra columns." },
        { status: 413 }
      );
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    const shopId = requireShopId(request, session);
    const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } });
    if (!shop) {
      logger.warn("customer_import_shop_missing", {
        userId: session.id,
        role: session.role,
        shopId,
        fileName: file.name,
      });
      return NextResponse.json({ error: "Selected shop no longer exists. Please switch to the correct shop and retry import." }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    logger.info("customer_import_buffer_ready", {
      userId: session.id,
      shopId,
      fileName: file.name,
      bufferBytes: buffer.length,
      durationMs: Date.now() - startedAt,
    });
    const summary = await importCustomersFromExcel(buffer, shopId);
    await logActivity({
      action: "excel_imported",
      userId: session.id,
      shopId,
      details: `${summary.totalProcessed} rows processed`,
    });
    logger.info("customer_import_upload_complete", {
      userId: session.id,
      shopId,
      fileName: file.name,
      totalProcessed: summary.totalProcessed,
      created: summary.created,
      duplicateNameCreated: summary.duplicateNameCreated ?? 0,
      updated: summary.updated,
      skipped: summary.skipped,
      skippedZeroBalance: summary.skippedZeroBalance ?? 0,
      errors: summary.errors.length,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(summary);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Import failed on the server";
    logger.error("customer_import_upload_failed", {
      error: message,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
