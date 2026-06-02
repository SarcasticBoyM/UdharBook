import { NextResponse } from "next/server";
import { z } from "zod";
import { createPasswordReset } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const schema = z.object({
  email: z.string().email(),
});

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const limited = rateLimit(`forgot:${ip}`, 5, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = schema.parse(await request.json());
    const reset = await createPasswordReset(body.email);
    if (reset) logger.info("password_reset_requested", { email: reset.email });

    return NextResponse.json({
      ok: true,
      message: "If this email exists, a reset link has been prepared.",
      resetUrl: process.env.NODE_ENV === "production" ? undefined : reset?.resetUrl,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

