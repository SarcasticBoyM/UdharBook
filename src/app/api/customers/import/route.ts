import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canImport } from "@/lib/permissions";
import { importCustomersFromExcel } from "@/lib/excel/import";
import { requireShopId } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canImport(session.role)) {
      return NextResponse.json({ error: "Admin only — log in as admin to import" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

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
    const buffer = Buffer.from(await file.arrayBuffer());
    const summary = await importCustomersFromExcel(buffer, shopId);
    await logActivity({
      action: "excel_imported",
      userId: session.id,
      shopId,
      details: `${summary.totalProcessed} rows processed`,
    });
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[import]", err);
    const message =
      err instanceof Error ? err.message : "Import failed on the server";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
