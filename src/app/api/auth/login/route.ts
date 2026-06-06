import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, login } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
    logger.info("login_request_started", {
      ip,
      userAgent: request.headers.get("user-agent") ?? "unknown",
      origin: request.headers.get("origin") ?? null,
    });
    const limited = rateLimit(`login:${ip}`, 8, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Too many login attempts" }, { status: 429 });
    }

    const body = schema.parse(await request.json());
    logger.info("login_request_parsed", { email: body.email.toLowerCase(), ip });
    const user = await login(body.email, body.password);
    if (!user) {
      logger.warn("login_failed", { email: body.email, ip });
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    logger.info("login_session_creation_started", { userId: user.id, email: user.email, role: user.role, shopId: user.shopId });
    await createSession(user);
    logger.info("login_request_succeeded", { userId: user.id, email: user.email, role: user.role, shopId: user.shopId });
    return NextResponse.json({ user: { name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
    }
    logger.error("login_request_failed", {
      error: error instanceof Error ? error.message : "Unknown login error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: "Unable to sign in right now. Please contact admin." },
      { status: 500 },
    );
  }
}
