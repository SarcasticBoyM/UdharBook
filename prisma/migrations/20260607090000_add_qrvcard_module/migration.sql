CREATE TABLE "QRVCard" (
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
  "website" TEXT,
  "logoUrl" TEXT,
  "bannerUrl" TEXT,
  "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "socialLinks" JSONB,
  "products" JSONB,
  "galleryImages" JSONB,
  "theme" TEXT NOT NULL DEFAULT 'professional-blue',
  "isPublic" BOOLEAN NOT NULL DEFAULT true,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "clickCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QRVCard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QRVCard_shopId_key" ON "QRVCard"("shopId");
CREATE UNIQUE INDEX "QRVCard_slug_key" ON "QRVCard"("slug");
CREATE INDEX "QRVCard_shopId_idx" ON "QRVCard"("shopId");
CREATE INDEX "QRVCard_slug_idx" ON "QRVCard"("slug");
CREATE INDEX "QRVCard_isPublic_idx" ON "QRVCard"("isPublic");

ALTER TABLE "QRVCard"
ADD CONSTRAINT "QRVCard_shopId_fkey"
FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
