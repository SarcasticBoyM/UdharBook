import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  await destroySession(searchParams.get("reason") ?? "explicit_logout");
  return NextResponse.json({ ok: true });
}
