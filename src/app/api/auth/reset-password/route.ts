import { NextResponse } from "next/server";
import { z } from "zod";
import { resetPassword } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const schema = z.object({
  token: z.string().min(32),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const limited = rateLimit(`reset:${ip}`, 6, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = schema.parse(await request.json());
    const ok = await resetPassword(body.token, body.password);
    if (!ok) return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 400 });
    logger.info("password_reset_completed");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

