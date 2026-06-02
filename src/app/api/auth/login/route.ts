import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, login } from "@/lib/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const user = await login(body.email, body.password);
    if (!user) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    await createSession(user);
    return NextResponse.json({ user: { name: user.name, email: user.email, role: user.role } });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
