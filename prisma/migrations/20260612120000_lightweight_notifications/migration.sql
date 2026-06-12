CREATE TYPE "NotificationTargetType" AS ENUM ('SHOP', 'ROLE', 'USER');

CREATE TABLE "Notification" (
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
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readByUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "deletedByUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_shopId_type_entityType_entityId_key" ON "Notification"("shopId", "type", "entityType", "entityId");
CREATE INDEX "Notification_shopId_createdAt_idx" ON "Notification"("shopId", "createdAt");
CREATE INDEX "Notification_shopId_targetType_roleTarget_createdAt_idx" ON "Notification"("shopId", "targetType", "roleTarget", "createdAt");
CREATE INDEX "Notification_shopId_userId_createdAt_idx" ON "Notification"("shopId", "userId", "createdAt");
CREATE INDEX "Notification_shopId_isRead_createdAt_idx" ON "Notification"("shopId", "isRead", "createdAt");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
