CREATE TYPE "NotificationPriority" AS ENUM ('CRITICAL', 'IMPORTANT', 'NORMAL');

ALTER TABLE "Notification"
ADD COLUMN "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL';

CREATE INDEX "Notification_shopId_priority_createdAt_idx"
ON "Notification"("shopId", "priority", "createdAt");
