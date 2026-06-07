CREATE TABLE IF NOT EXISTS "QRVCard" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "businessName" TEXT NOT NULL,
  "tagline" TEXT,
  "gstNumber" TEXT,
  "ownerName" TEXT,
  "mobile1" TEXT,
  "mobile2" TEXT,
  "whatsappNumber" TEXT,
  "email" TEXT,
  "address" TEXT,
  "mapUrl" TEXT,
  "mapsLink" TEXT,
  "website" TEXT,
  "instagram" TEXT,
  "facebook" TEXT,
  "youtube" TEXT,
  "logoUrl" TEXT,
  "bannerUrl" TEXT,
  "category" TEXT,
  "aboutBusiness" TEXT,
  "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "socialLinks" JSONB,
  "products" JSONB,
  "galleryImages" JSONB,
  "theme" TEXT NOT NULL DEFAULT 'professional-blue',
  "isPublic" BOOLEAN NOT NULL DEFAULT true,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "clickCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QRVCard_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "QRVCard" ADD COLUMN IF NOT EXISTS "mapsLink" TEXT;
ALTER TABLE "QRVCard" ADD COLUMN IF NOT EXISTS "instagram" TEXT;
ALTER TABLE "QRVCard" ADD COLUMN IF NOT EXISTS "facebook" TEXT;
ALTER TABLE "QRVCard" ADD COLUMN IF NOT EXISTS "youtube" TEXT;
ALTER TABLE "QRVCard" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "QRVCard" ADD COLUMN IF NOT EXISTS "aboutBusiness" TEXT;
ALTER TABLE "QRVCard" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

UPDATE "QRVCard"
SET "mapsLink" = COALESCE("mapsLink", "mapUrl")
WHERE "mapsLink" IS NULL AND "mapUrl" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "QRVCard_shopId_key" ON "QRVCard"("shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "QRVCard_slug_key" ON "QRVCard"("slug");
CREATE INDEX IF NOT EXISTS "QRVCard_shopId_idx" ON "QRVCard"("shopId");
CREATE INDEX IF NOT EXISTS "QRVCard_slug_idx" ON "QRVCard"("slug");
CREATE INDEX IF NOT EXISTS "QRVCard_isPublic_idx" ON "QRVCard"("isPublic");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'QRVCard_shopId_fkey'
  ) THEN
    ALTER TABLE "QRVCard"
    ADD CONSTRAINT "QRVCard_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "QRVCardGallery" (
  "id" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "title" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QRVCardGallery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "QRVCardBrand" (
  "id" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "logoUrl" TEXT,
  "website" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QRVCardBrand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "QRVCardAnalytics" (
  "id" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "metadata" JSONB,
  "ipHash" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QRVCardAnalytics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "QRVCardGallery_cardId_idx" ON "QRVCardGallery"("cardId");
CREATE INDEX IF NOT EXISTS "QRVCardGallery_cardId_sortOrder_idx" ON "QRVCardGallery"("cardId", "sortOrder");
CREATE INDEX IF NOT EXISTS "QRVCardBrand_cardId_idx" ON "QRVCardBrand"("cardId");
CREATE INDEX IF NOT EXISTS "QRVCardBrand_cardId_sortOrder_idx" ON "QRVCardBrand"("cardId", "sortOrder");
CREATE INDEX IF NOT EXISTS "QRVCardAnalytics_cardId_eventType_idx" ON "QRVCardAnalytics"("cardId", "eventType");
CREATE INDEX IF NOT EXISTS "QRVCardAnalytics_cardId_createdAt_idx" ON "QRVCardAnalytics"("cardId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'QRVCardGallery_cardId_fkey'
  ) THEN
    ALTER TABLE "QRVCardGallery"
    ADD CONSTRAINT "QRVCardGallery_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "QRVCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'QRVCardBrand_cardId_fkey'
  ) THEN
    ALTER TABLE "QRVCardBrand"
    ADD CONSTRAINT "QRVCardBrand_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "QRVCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'QRVCardAnalytics_cardId_fkey'
  ) THEN
    ALTER TABLE "QRVCardAnalytics"
    ADD CONSTRAINT "QRVCardAnalytics_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "QRVCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
