CREATE TABLE IF NOT EXISTS "ProductPreset" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "baseRate" DOUBLE PRECISION NOT NULL,
  "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "extraDiscountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "schemeDiscountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "gstPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "transportLoading" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductPreset_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductPreset_shopId_fkey'
  ) THEN
    ALTER TABLE "ProductPreset"
      ADD CONSTRAINT "ProductPreset_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ProductPreset_shopId_productName_key" ON "ProductPreset"("shopId", "productName");
CREATE INDEX IF NOT EXISTS "ProductPreset_shopId_productName_idx" ON "ProductPreset"("shopId", "productName");
CREATE INDEX IF NOT EXISTS "ProductPreset_shopId_updatedAt_idx" ON "ProductPreset"("shopId", "updatedAt");
