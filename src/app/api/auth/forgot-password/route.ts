import { NextResponse } from "next/server";
import { z } from "zod";
import { createPasswordReset } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { safeAuthRuntimeDiagnostics } from "@/lib/auth-diagnostics";

const schema = z.object({
  email: z.string().email(),
});

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  logger.info("password_reset_request_started", {
    traceId,
    ip,
    userAgent: request.headers.get("user-agent") ?? "unknown",
    origin: request.headers.get("origin") ?? null,
    diagnostics: safeAuthRuntimeDiagnostics(request),
  });
  const limited = rateLimit(`forgot:${ip}`, 5, 60_000);
  if (!limited.ok) {
    logger.warn("password_reset_request_rate_limited", { traceId, ip });
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = schema.parse(await request.json());
    logger.info("password_reset_request_received", { traceId, email: body.email.toLowerCase(), ip });
    const reset = await createPasswordReset(body.email, traceId);
    if (reset) logger.info("password_reset_requested", { traceId, email: reset.email, resetUrlPrepared: Boolean(reset.resetUrl) });

    return NextResponse.json({
      ok: true,
      message: "If this email exists, a reset link has been prepared.",
      resetUrl: process.env.NODE_ENV === "production" ? undefined : reset?.resetUrl,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn("password_reset_request_validation_failed", { traceId, ip, issues: error.issues });
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    logger.error("password_reset_request_failed", {
      traceId,
      ip,
      error: error instanceof Error ? error.message : "Unknown password reset request error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
