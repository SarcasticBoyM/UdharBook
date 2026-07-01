import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { webPushConfig } from "@/lib/web-push";
import {
  isPushSubscriptionStorageNotReady,
  logPushSubscriptionStorageError,
  pushSubscriptionStorageErrorResponse,
} from "@/lib/push-subscription-storage";

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
  const config = webPushConfig();
  try {
    const [activeCount, latest] = await Promise.all([
      prisma.pushSubscription.count({ where: { userId: session.id, shopId: session.shopId, isActive: true } }),
      prisma.pushSubscription.findFirst({
        where: { userId: session.id, shopId: session.shopId, isActive: true },
        select: { id: true, endpoint: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
      }),
    ]);
    return NextResponse.json({
      success: true,
      configured: config.configured,
      publicKey: config.publicKey,
      configError: config.error,
      diagnostics: config.diagnostics,
      storageReady: true,
      activeCount,
      latest,
    });
  } catch (error) {
    logPushSubscriptionStorageError("status", error);
    if (isPushSubscriptionStorageNotReady(error)) {
      return NextResponse.json(pushSubscriptionStorageErrorResponse(), { status: 503 });
    }
    return NextResponse.json({
      ok: false,
      error: "push_subscription_storage_unavailable",
      message: "Push subscription storage is temporarily unavailable.",
    }, { status: 503 });
  }
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
    logPushSubscriptionStorageError("save", error);
    if (isPushSubscriptionStorageNotReady(error)) {
      return NextResponse.json(pushSubscriptionStorageErrorResponse(), { status: 503 });
    }
    return NextResponse.json({
      ok: false,
      error: "push_subscription_storage_unavailable",
      message: "Could not save phone notification subscription.",
    }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { endpoint?: unknown; all?: unknown };
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : null;
  try {
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
  } catch (error) {
    logPushSubscriptionStorageError("disable", error);
    if (isPushSubscriptionStorageNotReady(error)) {
      return NextResponse.json(pushSubscriptionStorageErrorResponse(), { status: 503 });
    }
    return NextResponse.json({
      ok: false,
      error: "push_subscription_storage_unavailable",
      message: "Could not disable phone notification subscription.",
    }, { status: 503 });
  }
}
