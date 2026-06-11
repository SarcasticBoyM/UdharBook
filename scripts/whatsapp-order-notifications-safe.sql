-- Production-safe WhatsApp Order Notifications schema for Supabase SQL Editor.
-- Additive only: no DROP, no data-removing ALTER.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WhatsAppConnectionStatus') THEN
    CREATE TYPE "WhatsAppConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'LOGGED_OUT', 'ERROR');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WhatsAppNotificationStatus') THEN
    CREATE TYPE "WhatsAppNotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "WhatsAppOrderNotificationSetting" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "groupJid" TEXT,
  "groupName" TEXT,
  "selectedEvents" TEXT[] NOT NULL DEFAULT ARRAY['ORDER_CREATED', 'ORDER_EDITED', 'ORDER_DISPATCHED', 'ORDER_DELIVERED', 'ORDER_CANCELLED']::TEXT[],
  "templates" JSONB,
  "connectionStatus" "WhatsAppConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
  "lastQrCode" TEXT,
  "lastConnectedAt" TIMESTAMP(3),
  "lastDisconnectedAt" TIMESTAMP(3),
  "lastTestSentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppOrderNotificationSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WhatsAppNotificationJob" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "orderId" TEXT,
  "event" TEXT NOT NULL,
  "targetGroupJid" TEXT NOT NULL,
  "targetGroupName" TEXT,
  "message" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "WhatsAppNotificationStatus" NOT NULL DEFAULT 'PENDING',
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "maxRetries" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppNotificationJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WhatsAppSessionSecret" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppSessionSecret_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppOrderNotificationSetting_shopId_key" ON "WhatsAppOrderNotificationSetting"("shopId");
CREATE INDEX IF NOT EXISTS "WhatsAppOrderNotificationSetting_shopId_enabled_idx" ON "WhatsAppOrderNotificationSetting"("shopId", "enabled");
CREATE INDEX IF NOT EXISTS "WhatsAppOrderNotificationSetting_connectionStatus_idx" ON "WhatsAppOrderNotificationSetting"("connectionStatus");

CREATE INDEX IF NOT EXISTS "WhatsAppNotificationJob_shopId_status_nextAttemptAt_idx" ON "WhatsAppNotificationJob"("shopId", "status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "WhatsAppNotificationJob_shopId_event_createdAt_idx" ON "WhatsAppNotificationJob"("shopId", "event", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppNotificationJob_orderId_idx" ON "WhatsAppNotificationJob"("orderId");

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppSessionSecret_shopId_key_key" ON "WhatsAppSessionSecret"("shopId", "key");
CREATE INDEX IF NOT EXISTS "WhatsAppSessionSecret_shopId_idx" ON "WhatsAppSessionSecret"("shopId");
