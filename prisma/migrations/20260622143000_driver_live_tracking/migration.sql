ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DRIVER';
ALTER TYPE "OperationalRole" ADD VALUE IF NOT EXISTS 'DRIVER';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DriverTripStatus') THEN
    CREATE TYPE "DriverTripStatus" AS ENUM ('ACTIVE', 'ENDED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "DriverTrackingLink" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverTrackingLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DriverTrip" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "status" "DriverTripStatus" NOT NULL DEFAULT 'ACTIVE',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "startLat" DOUBLE PRECISION,
  "startLng" DOUBLE PRECISION,
  "endLat" DOUBLE PRECISION,
  "endLng" DOUBLE PRECISION,
  "lastLat" DOUBLE PRECISION,
  "lastLng" DOUBLE PRECISION,
  "lastAccuracy" DOUBLE PRECISION,
  "lastSpeed" DOUBLE PRECISION,
  "lastHeading" DOUBLE PRECISION,
  "lastLocationAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverTrip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DriverLocationPoint" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "tripId" TEXT,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "accuracy" DOUBLE PRECISION,
  "speed" DOUBLE PRECISION,
  "heading" DOUBLE PRECISION,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverLocationPoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DriverTrackingLink_driverId_key" ON "DriverTrackingLink"("driverId");
CREATE UNIQUE INDEX IF NOT EXISTS "DriverTrackingLink_token_key" ON "DriverTrackingLink"("token");
CREATE INDEX IF NOT EXISTS "DriverTrackingLink_shopId_driverId_idx" ON "DriverTrackingLink"("shopId", "driverId");
CREATE INDEX IF NOT EXISTS "DriverTrackingLink_shopId_isEnabled_idx" ON "DriverTrackingLink"("shopId", "isEnabled");
CREATE INDEX IF NOT EXISTS "DriverTrip_shopId_driverId_idx" ON "DriverTrip"("shopId", "driverId");
CREATE INDEX IF NOT EXISTS "DriverTrip_shopId_driverId_status_idx" ON "DriverTrip"("shopId", "driverId", "status");
CREATE INDEX IF NOT EXISTS "DriverTrip_shopId_status_updatedAt_idx" ON "DriverTrip"("shopId", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "DriverLocationPoint_shopId_driverId_idx" ON "DriverLocationPoint"("shopId", "driverId");
CREATE INDEX IF NOT EXISTS "DriverLocationPoint_shopId_driverId_capturedAt_idx" ON "DriverLocationPoint"("shopId", "driverId", "capturedAt");
CREATE INDEX IF NOT EXISTS "DriverLocationPoint_tripId_capturedAt_idx" ON "DriverLocationPoint"("tripId", "capturedAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverTrackingLink_shopId_fkey') THEN
    ALTER TABLE "DriverTrackingLink" ADD CONSTRAINT "DriverTrackingLink_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverTrackingLink_driverId_fkey') THEN
    ALTER TABLE "DriverTrackingLink" ADD CONSTRAINT "DriverTrackingLink_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverTrip_shopId_fkey') THEN
    ALTER TABLE "DriverTrip" ADD CONSTRAINT "DriverTrip_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverTrip_driverId_fkey') THEN
    ALTER TABLE "DriverTrip" ADD CONSTRAINT "DriverTrip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverLocationPoint_shopId_fkey') THEN
    ALTER TABLE "DriverLocationPoint" ADD CONSTRAINT "DriverLocationPoint_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverLocationPoint_driverId_fkey') THEN
    ALTER TABLE "DriverLocationPoint" ADD CONSTRAINT "DriverLocationPoint_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverLocationPoint_tripId_fkey') THEN
    ALTER TABLE "DriverLocationPoint" ADD CONSTRAINT "DriverLocationPoint_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "DriverTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
