import { NextResponse } from "next/server";
import { z } from "zod";
import { resetPassword } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { safeAuthRuntimeDiagnostics } from "@/lib/auth-diagnostics";

const schema = z.object({
  token: z.string().min(32),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  logger.info("password_reset_completion_started", {
    traceId,
    ip,
    userAgent: request.headers.get("user-agent") ?? "unknown",
    origin: request.headers.get("origin") ?? null,
    diagnostics: safeAuthRuntimeDiagnostics(request),
  });
  const limited = rateLimit(`reset:${ip}`, 6, 60_000);
  if (!limited.ok) {
    logger.warn("password_reset_completion_rate_limited", { traceId, ip });
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = schema.parse(await request.json());
    logger.info("password_reset_completion_requested", { traceId, ip, tokenPrefix: body.token.slice(0, 8) });
    const ok = await resetPassword(body.token, body.password, traceId);
    if (!ok) return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 400 });
    logger.info("password_reset_completed", { traceId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn("password_reset_completion_validation_failed", { traceId, ip, issues: error.issues });
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    logger.error("password_reset_completion_failed", {
      traceId,
      ip,
      error: error instanceof Error ? error.message : "Unknown password reset completion error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
