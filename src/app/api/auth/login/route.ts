import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, login } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { safeAuthRuntimeDiagnostics } from "@/lib/auth-diagnostics";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
    logger.info("login_request_started", {
      traceId,
      ip,
      userAgent: request.headers.get("user-agent") ?? "unknown",
      origin: request.headers.get("origin") ?? null,
      diagnostics: safeAuthRuntimeDiagnostics(request),
    });
    const limited = rateLimit(`login:${ip}`, 8, 60_000);
    if (!limited.ok) {
      logger.warn("login_rate_limited", { traceId, ip });
      return NextResponse.json({ error: "Too many login attempts" }, { status: 429 });
    }

    const body = schema.parse(await request.json());
    logger.info("login_request_parsed", { traceId, email: body.email.toLowerCase(), ip });
    const user = await login(body.email, body.password, traceId);
    if (!user) {
      logger.warn("login_failed", { traceId, email: body.email, ip });
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    logger.info("login_session_creation_started", { traceId, userId: user.id, email: user.email, role: user.role, shopId: user.shopId });
    await createSession(user, traceId);
    logger.info("login_request_succeeded", {
      traceId,
      userId: user.id,
      email: user.email,
      role: user.role,
      shopId: user.shopId,
      cookieExpected: true,
      cookieSecure: process.env.NODE_ENV === "production",
      cookieSameSite: "lax",
    });
    return NextResponse.json({ user: { name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn("login_request_validation_failed", { traceId, issues: error.issues });
      return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
    }
    logger.error("login_request_failed", {
      traceId,
      error: error instanceof Error ? error.message : "Unknown login error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: "Unable to sign in right now. Please contact admin." },
      { status: 500 },
    );
  }
}
