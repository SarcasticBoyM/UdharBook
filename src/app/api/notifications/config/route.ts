import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { webPushConfig } from "@/lib/web-push";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = webPushConfig();
  return NextResponse.json({
    success: true,
    configured: config.configured,
    publicKey: config.publicKey,
    configError: config.error,
    diagnostics: config.diagnostics,
  });
}
