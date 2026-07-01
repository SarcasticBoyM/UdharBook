import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { webPushConfig } from "@/lib/web-push";

export const runtime = "nodejs";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(20).max(500),
    auth: z.string().min(8).max(500),
  }),
  deviceInfo: z.string().trim().max(200).optional().nullable(),
});

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [activeCount, latest] = await Promise.all([
    prisma.pushSubscription.count({ where: { userId: session.id, shopId: session.shopId, isActive: true } }),
    prisma.pushSubscription.findFirst({
      where: { userId: session.id, shopId: session.shopId, isActive: true },
      select: { id: true, endpoint: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  const config = webPushConfig();
  return NextResponse.json({
    success: true,
    configured: config.configured,
    publicKey: config.publicKey,
    configError: config.error,
    diagnostics: config.diagnostics,
    activeCount,
    latest,
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const config = webPushConfig();
  if (!config.configured) {
    return NextResponse.json({
      error: config.error,
      diagnostics: config.diagnostics,
    }, { status: 503 });
  }
  try {
    const body = subscriptionSchema.parse(await request.json());
    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      update: {
        userId: session.id,
        shopId: session.shopId,
        p256dhKey: body.keys.p256dh,
        authKey: body.keys.auth,
        userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
        deviceInfo: body.deviceInfo || null,
        isActive: true,
      },
      create: {
        userId: session.id,
        shopId: session.shopId,
        endpoint: body.endpoint,
        p256dhKey: body.keys.p256dh,
        authKey: body.keys.auth,
        userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
        deviceInfo: body.deviceInfo || null,
      },
      select: { id: true, updatedAt: true },
    });
    return NextResponse.json({ success: true, subscription });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not save phone notification subscription." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { endpoint?: unknown; all?: unknown };
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : null;
  await prisma.pushSubscription.updateMany({
    where: {
      userId: session.id,
      shopId: session.shopId,
      isActive: true,
      ...(body.all === true ? {} : endpoint ? { endpoint } : { id: "__missing_endpoint__" }),
    },
    data: { isActive: false },
  });
  return NextResponse.json({ success: true });
}
