CREATE TYPE "NotificationRetryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

ALTER TABLE "Notification"
ADD COLUMN "idempotencyKey" TEXT;

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

CREATE UNIQUE INDEX "Notification_idempotencyKey_key"
ON "Notification"("idempotencyKey");

DROP INDEX "Notification_shopId_type_entityType_entityId_key";

CREATE INDEX "Notification_shopId_type_entityType_entityId_idx"
ON "Notification"("shopId", "type", "entityType", "entityId");

CREATE TABLE "NotificationRetry" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationRetry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationRetry_idempotencyKey_key"
ON "NotificationRetry"("idempotencyKey");

CREATE INDEX "NotificationRetry_shopId_status_nextRetryAt_idx"
ON "NotificationRetry"("shopId", "status", "nextRetryAt");

CREATE INDEX "NotificationRetry_status_nextRetryAt_idx"
ON "NotificationRetry"("status", "nextRetryAt");

CREATE INDEX "NotificationRetry_shopId_eventType_entityType_entityId_idx"
ON "NotificationRetry"("shopId", "eventType", "entityType", "entityId");

ALTER TABLE "NotificationRetry"
ADD CONSTRAINT "NotificationRetry_shopId_fkey"
FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationRetry"
ADD CONSTRAINT "NotificationRetry_targetUserId_fkey"
FOREIGN KEY ("targetUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
