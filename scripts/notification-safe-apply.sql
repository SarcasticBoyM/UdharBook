-- UdharBook notification storage reconciliation.
-- Additive, idempotent, and safe to run repeatedly in Supabase SQL Editor.
-- This script does not drop, truncate, or reset any business or notification data.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type typ
    JOIN pg_namespace ns ON ns.oid = typ.typnamespace
    WHERE ns.nspname = 'public' AND typ.typname = 'NotificationTargetType'
  ) THEN
    CREATE TYPE "NotificationTargetType" AS ENUM ('SHOP', 'ROLE', 'USER');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type typ
    JOIN pg_namespace ns ON ns.oid = typ.typnamespace
    WHERE ns.nspname = 'public' AND typ.typname = 'NotificationPriority'
  ) THEN
    CREATE TYPE "NotificationPriority" AS ENUM ('CRITICAL', 'IMPORTANT', 'NORMAL');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type typ
    JOIN pg_namespace ns ON ns.oid = typ.typnamespace
    WHERE ns.nspname = 'public' AND typ.typname = 'NotificationRetryStatus'
  ) THEN
    CREATE TYPE "NotificationRetryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');
  END IF;
END
$$;

ALTER TYPE "NotificationTargetType" ADD VALUE IF NOT EXISTS 'SHOP';
ALTER TYPE "NotificationTargetType" ADD VALUE IF NOT EXISTS 'ROLE';
ALTER TYPE "NotificationTargetType" ADD VALUE IF NOT EXISTS 'USER';
ALTER TYPE "NotificationPriority" ADD VALUE IF NOT EXISTS 'CRITICAL';
ALTER TYPE "NotificationPriority" ADD VALUE IF NOT EXISTS 'IMPORTANT';
ALTER TYPE "NotificationPriority" ADD VALUE IF NOT EXISTS 'NORMAL';
ALTER TYPE "NotificationRetryStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "NotificationRetryStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "NotificationRetryStatus" ADD VALUE IF NOT EXISTS 'SENT';
ALTER TYPE "NotificationRetryStatus" ADD VALUE IF NOT EXISTS 'FAILED';

COMMIT;
BEGIN;

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
  "type" || ':' ||
  COALESCE(NULLIF("entityType", ''), 'GENERAL') || ':' ||
  COALESCE(NULLIF("entityId", ''), 'NONE') || ':' ||
  CASE
    WHEN "targetType" = 'USER' THEN 'USER:' || COALESCE("userId", 'NONE')
    WHEN "targetType" = 'ROLE' THEN 'ROLE:' || COALESCE("roleTarget", 'NONE')
    ELSE 'SHOP'
  END
WHERE "idempotencyKey" IS NULL;

-- Superseded by recipient-aware idempotency. This only removes the obsolete
-- uniqueness rule; it does not remove notification rows.
DROP INDEX IF EXISTS "Notification_shopId_type_entityType_entityId_key";

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

ALTER TABLE "NotificationRetry"
  ADD COLUMN IF NOT EXISTS "targetUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "targetRole" TEXT,
  ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "maxRetries" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS "lastError" TEXT,
  ADD COLUMN IF NOT EXISTS "status" "NotificationRetryStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

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

-- Verification summary. Every missing_* value must be 0.
WITH required_tables(name) AS (
  VALUES ('Notification'), ('NotificationRetry')
),
required_columns(table_name, column_name) AS (
  VALUES
    ('Notification', 'id'), ('Notification', 'shopId'), ('Notification', 'userId'),
    ('Notification', 'roleTarget'), ('Notification', 'targetType'), ('Notification', 'type'),
    ('Notification', 'title'), ('Notification', 'message'), ('Notification', 'entityType'),
    ('Notification', 'entityId'), ('Notification', 'actionUrl'), ('Notification', 'metadata'),
    ('Notification', 'idempotencyKey'), ('Notification', 'priority'), ('Notification', 'isRead'),
    ('Notification', 'readByUserIds'), ('Notification', 'deletedByUserIds'), ('Notification', 'createdAt'),
    ('NotificationRetry', 'id'), ('NotificationRetry', 'shopId'), ('NotificationRetry', 'eventType'),
    ('NotificationRetry', 'entityType'), ('NotificationRetry', 'entityId'),
    ('NotificationRetry', 'targetUserId'), ('NotificationRetry', 'targetRole'),
    ('NotificationRetry', 'idempotencyKey'), ('NotificationRetry', 'payload'),
    ('NotificationRetry', 'retryCount'), ('NotificationRetry', 'maxRetries'),
    ('NotificationRetry', 'nextRetryAt'), ('NotificationRetry', 'lastError'),
    ('NotificationRetry', 'status'), ('NotificationRetry', 'createdAt'),
    ('NotificationRetry', 'updatedAt')
)
SELECT
  (SELECT COUNT(*) FROM required_tables required
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.tables actual
      WHERE actual.table_schema = 'public' AND actual.table_name = required.name
    )) AS missing_tables,
  (SELECT COUNT(*) FROM required_columns required
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = required.table_name
        AND actual.column_name = required.column_name
    )) AS missing_columns;

SELECT "id", "type", "priority", "createdAt" FROM "Notification" LIMIT 1;
SELECT "id", "eventType", "status", "nextRetryAt" FROM "NotificationRetry" LIMIT 1;
