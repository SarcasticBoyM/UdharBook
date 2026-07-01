-- Some production databases already contain these enums from an earlier
-- manual/schema state. Preserve the existing enum and only create it when it
-- is absent from the public schema.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type type
    JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public'
      AND type.typname = 'WhatsAppConnectionStatus'
  ) THEN
    CREATE TYPE "WhatsAppConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'LOGGED_OUT', 'ERROR');
  END IF;
END
$$;

ALTER TYPE "WhatsAppConnectionStatus" ADD VALUE IF NOT EXISTS 'DISCONNECTED';
ALTER TYPE "WhatsAppConnectionStatus" ADD VALUE IF NOT EXISTS 'CONNECTING';
ALTER TYPE "WhatsAppConnectionStatus" ADD VALUE IF NOT EXISTS 'CONNECTED';
ALTER TYPE "WhatsAppConnectionStatus" ADD VALUE IF NOT EXISTS 'LOGGED_OUT';
ALTER TYPE "WhatsAppConnectionStatus" ADD VALUE IF NOT EXISTS 'ERROR';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type type
    JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public'
      AND type.typname = 'WhatsAppNotificationStatus'
  ) THEN
    CREATE TYPE "WhatsAppNotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');
  END IF;
END
$$;

ALTER TYPE "WhatsAppNotificationStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "WhatsAppNotificationStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "WhatsAppNotificationStatus" ADD VALUE IF NOT EXISTS 'SENT';
ALTER TYPE "WhatsAppNotificationStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "WhatsAppNotificationStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

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
  "updatedAt" TIMESTAMP(3) NOT NULL,

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
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WhatsAppNotificationJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WhatsAppSessionSecret" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

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

-- Add foreign keys only when the exact table constraint is missing. Existing
-- tables and rows are preserved; invalid legacy rows will stop deployment
-- instead of being deleted or repaired implicitly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'WhatsAppOrderNotificationSetting_shopId_fkey'
      AND conrelid = '"WhatsAppOrderNotificationSetting"'::regclass
  ) THEN
    ALTER TABLE "WhatsAppOrderNotificationSetting"
      ADD CONSTRAINT "WhatsAppOrderNotificationSetting_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'WhatsAppNotificationJob_shopId_fkey'
      AND conrelid = '"WhatsAppNotificationJob"'::regclass
  ) THEN
    ALTER TABLE "WhatsAppNotificationJob"
      ADD CONSTRAINT "WhatsAppNotificationJob_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'WhatsAppSessionSecret_shopId_fkey'
      AND conrelid = '"WhatsAppSessionSecret"'::regclass
  ) THEN
    ALTER TABLE "WhatsAppSessionSecret"
      ADD CONSTRAINT "WhatsAppSessionSecret_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
