CREATE TYPE "WhatsAppConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'LOGGED_OUT', 'ERROR');

CREATE TYPE "WhatsAppNotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

CREATE TABLE "WhatsAppOrderNotificationSetting" (
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
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WhatsAppOrderNotificationSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppNotificationJob" (
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
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WhatsAppNotificationJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppSessionSecret" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WhatsAppSessionSecret_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppOrderNotificationSetting_shopId_key" ON "WhatsAppOrderNotificationSetting"("shopId");
CREATE INDEX "WhatsAppOrderNotificationSetting_shopId_enabled_idx" ON "WhatsAppOrderNotificationSetting"("shopId", "enabled");
CREATE INDEX "WhatsAppOrderNotificationSetting_connectionStatus_idx" ON "WhatsAppOrderNotificationSetting"("connectionStatus");
CREATE INDEX "WhatsAppNotificationJob_shopId_status_nextAttemptAt_idx" ON "WhatsAppNotificationJob"("shopId", "status", "nextAttemptAt");
CREATE INDEX "WhatsAppNotificationJob_shopId_event_createdAt_idx" ON "WhatsAppNotificationJob"("shopId", "event", "createdAt");
CREATE INDEX "WhatsAppNotificationJob_orderId_idx" ON "WhatsAppNotificationJob"("orderId");
CREATE UNIQUE INDEX "WhatsAppSessionSecret_shopId_key_key" ON "WhatsAppSessionSecret"("shopId", "key");
CREATE INDEX "WhatsAppSessionSecret_shopId_idx" ON "WhatsAppSessionSecret"("shopId");

ALTER TABLE "WhatsAppOrderNotificationSetting"
  ADD CONSTRAINT "WhatsAppOrderNotificationSetting_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsAppNotificationJob"
  ADD CONSTRAINT "WhatsAppNotificationJob_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsAppSessionSecret"
  ADD CONSTRAINT "WhatsAppSessionSecret_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
