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
    const limited = rateLimit(`login:${ip}`, 8, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Too many login attempts" }, { status: 429 });
    }

    const body = schema.parse(await request.json());
    const user = await login(body.email, body.password);
    if (!user) {
      logger.warn("login_failed", { email: body.email, ip });
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    await createSession(user);
    return NextResponse.json({ user: { name: user.name, email: user.email, role: user.role } });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
