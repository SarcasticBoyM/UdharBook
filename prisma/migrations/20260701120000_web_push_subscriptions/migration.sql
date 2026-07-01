CREATE TABLE "PushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dhKey" TEXT NOT NULL,
  "authKey" TEXT NOT NULL,
  "userAgent" TEXT,
  "deviceInfo" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PushDelivery" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_isActive_idx" ON "PushSubscription"("userId", "isActive");
CREATE INDEX "PushSubscription_shopId_isActive_idx" ON "PushSubscription"("shopId", "isActive");
CREATE UNIQUE INDEX "PushDelivery_notificationId_subscriptionId_key" ON "PushDelivery"("notificationId", "subscriptionId");
CREATE INDEX "PushDelivery_status_updatedAt_idx" ON "PushDelivery"("status", "updatedAt");
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
