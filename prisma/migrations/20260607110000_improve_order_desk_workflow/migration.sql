ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'ORDER_RECEIVED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DISPATCHED';

ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'ORDER_RECEIVED';

CREATE TABLE IF NOT EXISTS "OrderActivity" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousStatus" "OrderStatus",
    "newStatus" "OrderStatus",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrderActivity_shopId_createdAt_idx" ON "OrderActivity"("shopId", "createdAt");
CREATE INDEX IF NOT EXISTS "OrderActivity_orderId_createdAt_idx" ON "OrderActivity"("orderId", "createdAt");
CREATE INDEX IF NOT EXISTS "OrderActivity_userId_createdAt_idx" ON "OrderActivity"("userId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderActivity_shopId_fkey'
  ) THEN
    ALTER TABLE "OrderActivity"
      ADD CONSTRAINT "OrderActivity_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderActivity_orderId_fkey'
  ) THEN
    ALTER TABLE "OrderActivity"
      ADD CONSTRAINT "OrderActivity_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderActivity_userId_fkey'
  ) THEN
    ALTER TABLE "OrderActivity"
      ADD CONSTRAINT "OrderActivity_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
