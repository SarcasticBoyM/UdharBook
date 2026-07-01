import webpush from "web-push";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

let vapidConfigured = false;
let configuredSignature = "";
let warnedMissingConfig = false;

const PUBLIC_KEY_NAMES = [
  "NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY",
  "WEB_PUSH_VAPID_PUBLIC_KEY",
  "VAPID_PUBLIC_KEY",
] as const;
const PRIVATE_KEY_NAMES = ["WEB_PUSH_VAPID_PRIVATE_KEY", "VAPID_PRIVATE_KEY"] as const;
const SUBJECT_NAMES = ["WEB_PUSH_CONTACT_EMAIL", "VAPID_SUBJECT"] as const;

function firstEnvironmentValue(names: readonly string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function normalizeSubject(value: string) {
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(value)) return value;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return `mailto:${value}`;
  if (/^https?:\/\/\S+$/i.test(value)) return value;
  return null;
}

export type WebPushConfigDiagnostics = {
  publicKeyPresent: boolean;
  privateKeyPresent: boolean;
  subjectPresent: boolean;
  publicKeyLength: number;
  privateKeyLength: number;
  subjectLooksValid: boolean;
  runtime: "nodejs";
};

export function webPushConfig() {
  // Dynamic lookup keeps the public key server-resolved instead of relying on a
  // NEXT_PUBLIC value that may have been inlined in an older client build.
  const publicKey = firstEnvironmentValue(PUBLIC_KEY_NAMES);
  const privateKey = firstEnvironmentValue(PRIVATE_KEY_NAMES);
  const rawSubject = firstEnvironmentValue(SUBJECT_NAMES);
  const subject = rawSubject ? normalizeSubject(rawSubject) : null;
  const diagnostics: WebPushConfigDiagnostics = {
    publicKeyPresent: Boolean(publicKey),
    privateKeyPresent: Boolean(privateKey),
    subjectPresent: Boolean(rawSubject),
    publicKeyLength: publicKey.length,
    privateKeyLength: privateKey.length,
    subjectLooksValid: Boolean(subject),
    runtime: "nodejs",
  };
  const error = !publicKey
    ? "Missing VAPID public key."
    : !privateKey
      ? "Missing VAPID private key."
      : !rawSubject
        ? "Missing push contact/subject."
        : !subject
          ? "Invalid push contact/subject format. Use mailto:email@example.com, a plain email, or an HTTPS URL."
          : null;

  if (error) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      logger.error("web_push_vapid_config_missing", {
        ...diagnostics,
        error,
      });
    }
    return {
      configured: false as const,
      publicKey: publicKey || null,
      error,
      diagnostics,
    };
  }

  if (!subject) {
    throw new Error("Web Push subject validation reached an unexpected state.");
  }
  const signature = `${subject}\n${publicKey}\n${privateKey}`;
  if (!vapidConfigured || configuredSignature !== signature) {
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      vapidConfigured = true;
      configuredSignature = signature;
    } catch (configurationError) {
      const message = configurationError instanceof Error
        ? configurationError.message
        : "Invalid VAPID key configuration.";
      logger.error("web_push_vapid_config_invalid", {
        ...diagnostics,
        error: message,
      });
      return {
        configured: false as const,
        publicKey,
        error: `Invalid VAPID configuration: ${message}`,
        diagnostics,
      };
    }
  }
  return { configured: true as const, publicKey, error: null, diagnostics };
}

function safeBody(entityType?: string | null) {
  if (entityType === "FOLLOW_UP") return "Tap to open follow-up";
  if (entityType === "ORDER") return "Tap to open order details";
  if (entityType === "TASK") return "Tap to open task details";
  return "Tap to open UdharBook";
}

export type PushNotificationRecord = {
  id: string;
  shopId: string;
  title: string;
  type: string;
  entityType: string | null;
  entityId: string | null;
  actionUrl: string | null;
  priority: string;
};

export async function sendPushForNotification(notification: PushNotificationRecord, recipientUserIds: string[]) {
  const config = webPushConfig();
  if (!config.configured || recipientUserIds.length === 0) return { sent: 0, failed: 0, skipped: true };

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { shopId: notification.shopId, userId: { in: recipientUserIds }, isActive: true },
  });
  let sent = 0;
  let failed = 0;

  await Promise.allSettled(subscriptions.map(async (subscription) => {
    try {
      await prisma.pushDelivery.create({
        data: { notificationId: notification.id, subscriptionId: subscription.id },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
      throw error;
    }

    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dhKey, auth: subscription.authKey },
      }, JSON.stringify({
        title: notification.title,
        body: safeBody(notification.entityType),
        url: notification.actionUrl || "/",
        notificationType: notification.type,
        entityType: notification.entityType,
        entityId: notification.entityId,
        tag: notification.id,
        requireInteraction: notification.priority === "CRITICAL",
      }));
      await prisma.pushDelivery.updateMany({
        where: { notificationId: notification.id, subscriptionId: subscription.id },
        data: { status: "SENT", lastError: null },
      });
      sent += 1;
    } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error
        ? Number((error as { statusCode?: number }).statusCode)
        : 0;
      const message = error instanceof Error ? error.message.slice(0, 500) : "Push delivery failed";
      await prisma.pushDelivery.updateMany({
        where: { notificationId: notification.id, subscriptionId: subscription.id },
        data: { status: "FAILED", lastError: message },
      });
      if (statusCode === 404 || statusCode === 410) {
        await prisma.pushSubscription.update({
          where: { id: subscription.id },
          data: { isActive: false },
        });
      }
      failed += 1;
      logger.warn("web_push_delivery_failed", {
        notificationId: notification.id,
        subscriptionId: subscription.id,
        statusCode,
        error: message,
      });
    }
  }));

  return { sent, failed, skipped: false };
}

export async function sendTestPush(subscriptionId: string, userId: string, shopId: string) {
  const config = webPushConfig();
  if (!config.configured) throw new Error(config.error);
  const subscription = await prisma.pushSubscription.findFirst({
    where: { id: subscriptionId, userId, shopId, isActive: true },
  });
  if (!subscription) throw new Error("Active push subscription not found.");
  await webpush.sendNotification({
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dhKey, auth: subscription.authKey },
  }, JSON.stringify({
    title: "UdharBook phone notifications enabled",
    body: "Test successful. Important updates will appear here.",
    url: "/",
    notificationType: "TEST_PUSH",
    tag: `test-${Date.now()}`,
  }));
}
