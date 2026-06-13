-- Run once in Supabase SQL Editor if Prisma migration deploy cannot reach the database.
-- Additive and idempotent: no notification or business records are deleted.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationTargetType') THEN
    CREATE TYPE "NotificationTargetType" AS ENUM ('SHOP', 'ROLE', 'USER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationRetryStatus') THEN
    CREATE TYPE "NotificationRetryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationPriority') THEN
    CREATE TYPE "NotificationPriority" AS ENUM ('CRITICAL', 'IMPORTANT', 'NORMAL');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "userId" TEXT,
  "roleTarget" TEXT,
  "targetType" "NotificationTargetType" NOT NULL DEFAULT 'SHOP',
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "actionUrl" TEXT,
  "metadata" JSONB,
  "idempotencyKey" TEXT,
  "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "readByUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "deletedByUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Notification"
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "roleTarget" TEXT,
  ADD COLUMN IF NOT EXISTS "targetType" "NotificationTargetType" NOT NULL DEFAULT 'SHOP',
  ADD COLUMN IF NOT EXISTS "type" TEXT,
  ADD COLUMN IF NOT EXISTS "title" TEXT,
  ADD COLUMN IF NOT EXISTS "message" TEXT,
  ADD COLUMN IF NOT EXISTS "entityType" TEXT,
  ADD COLUMN IF NOT EXISTS "entityId" TEXT,
  ADD COLUMN IF NOT EXISTS "actionUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "metadata" JSONB,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS "isRead" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "readByUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "deletedByUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Notification"
SET "idempotencyKey" =
  "shopId" || ':' ||
  COALESCE("type", 'UNKNOWN') || ':' ||
  COALESCE(NULLIF("entityType", ''), 'GENERAL') || ':' ||
  COALESCE(NULLIF("entityId", ''), 'NONE') || ':' ||
  CASE
    WHEN "targetType" = 'USER' THEN 'USER:' || COALESCE("userId", 'NONE')
    WHEN "targetType" = 'ROLE' THEN 'ROLE:' || COALESCE("roleTarget", 'NONE')
    ELSE 'SHOP'
  END
WHERE "idempotencyKey" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Notification_idempotencyKey_key"
  ON "Notification"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "Notification_shopId_type_entityType_entityId_idx"
  ON "Notification"("shopId", "type", "entityType", "entityId");
CREATE INDEX IF NOT EXISTS "Notification_shopId_createdAt_idx"
  ON "Notification"("shopId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_shopId_targetType_roleTarget_createdAt_idx"
  ON "Notification"("shopId", "targetType", "roleTarget", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_shopId_userId_createdAt_idx"
  ON "Notification"("shopId", "userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_shopId_isRead_createdAt_idx"
  ON "Notification"("shopId", "isRead", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_shopId_priority_createdAt_idx"
  ON "Notification"("shopId", "priority", "createdAt");

CREATE TABLE IF NOT EXISTS "NotificationRetry" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "targetUserId" TEXT,
  "targetRole" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "maxRetries" INTEGER NOT NULL DEFAULT 4,
  "nextRetryAt" TIMESTAMP(3) NOT NULL,
  "lastError" TEXT,
  "status" "NotificationRetryStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationRetry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationRetry_idempotencyKey_key"
  ON "NotificationRetry"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "NotificationRetry_shopId_status_nextRetryAt_idx"
  ON "NotificationRetry"("shopId", "status", "nextRetryAt");
CREATE INDEX IF NOT EXISTS "NotificationRetry_status_nextRetryAt_idx"
  ON "NotificationRetry"("status", "nextRetryAt");
CREATE INDEX IF NOT EXISTS "NotificationRetry_shopId_eventType_entityType_entityId_idx"
  ON "NotificationRetry"("shopId", "eventType", "entityType", "entityId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_shopId_fkey') THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT "Notification_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_userId_fkey') THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT "Notification_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NotificationRetry_shopId_fkey') THEN
    ALTER TABLE "NotificationRetry"
      ADD CONSTRAINT "NotificationRetry_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NotificationRetry_targetUserId_fkey') THEN
    ALTER TABLE "NotificationRetry"
      ADD CONSTRAINT "NotificationRetry_targetUserId_fkey"
      FOREIGN KEY ("targetUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

COMMIT;

-- Safe verification result: expected tables and columns only, no message content.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('Notification', 'NotificationRetry')
ORDER BY table_name, ordinal_position;
