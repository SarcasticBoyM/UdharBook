import { NextResponse } from "next/server";
import { prisma, withPrismaRetry } from "@/lib/db";
import { databaseUrlInfo } from "@/lib/database-url";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = {
    databaseUrl: Boolean(process.env.DATABASE_URL),
    directUrl: Boolean(process.env.DIRECT_URL),
    sessionSecret: Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 24),
    ocrSpaceApiKey: Boolean(process.env.OCR_SPACE_API_KEY),
    databaseUrlInfo: databaseUrlInfo(),
    database: false,
  };

  try {
    await withPrismaRetry(() => prisma.$queryRaw`SELECT 1`, { operation: "health_check" });
    checks.database = true;
  } catch {
    checks.database = false;
  }

  const ok = checks.databaseUrl && checks.sessionSecret && checks.database;

  return NextResponse.json(
    {
      ok,
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
