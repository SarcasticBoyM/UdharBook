CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'CANCELLED');

CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "staffVisitId" TEXT,
    "orderDetails" TEXT NOT NULL,
    "preferredDeliveryDate" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'Normal',
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "sourceModule" TEXT NOT NULL DEFAULT 'FIELD_VISIT',
    "visitSource" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Order_shopId_staffVisitId_key" ON "Order"("shopId", "staffVisitId");
CREATE INDEX "Order_shopId_status_priority_idx" ON "Order"("shopId", "status", "priority");
CREATE INDEX "Order_shopId_preferredDeliveryDate_idx" ON "Order"("shopId", "preferredDeliveryDate");
CREATE INDEX "Order_shopId_createdAt_idx" ON "Order"("shopId", "createdAt");
CREATE INDEX "Order_shopId_createdById_createdAt_idx" ON "Order"("shopId", "createdById", "createdAt");
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");

ALTER TABLE "Order" ADD CONSTRAINT "Order_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_staffVisitId_fkey" FOREIGN KEY ("staffVisitId") REFERENCES "StaffVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
