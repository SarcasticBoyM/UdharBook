-- Add school-only roles without recreating the production enum.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SCHOOL_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SCHOOL_DRIVER';

CREATE TABLE IF NOT EXISTS "SchoolVehicle" (
  "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "vehicleNumber" TEXT, "driverId" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolVehicle_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "SchoolTransportRoute" (
  "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT, "startPointName" TEXT, "endPointName" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SchoolTransportRoute_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "SchoolTrackingLink" (
  "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "vehicleId" TEXT NOT NULL, "routeId" TEXT,
  "token" TEXT NOT NULL, "isEnabled" BOOLEAN NOT NULL DEFAULT true, "expiresAt" TIMESTAMP(3),
  "regeneratedAt" TIMESTAMP(3), "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolTrackingLink_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "SchoolTrip" (
  "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "vehicleId" TEXT NOT NULL, "routeId" TEXT,
  "driverId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'RUNNING', "tripLabel" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "endedAt" TIMESTAMP(3),
  "lastLatitude" DOUBLE PRECISION, "lastLongitude" DOUBLE PRECISION, "lastAccuracyM" DOUBLE PRECISION,
  "lastSpeedKmph" DOUBLE PRECISION, "lastHeading" DOUBLE PRECISION, "lastBatteryPct" INTEGER,
  "lastLocationAt" TIMESTAMP(3), "pointCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolTrip_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "SchoolTripPoint" (
  "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "tripId" TEXT NOT NULL, "vehicleId" TEXT NOT NULL,
  "driverId" TEXT NOT NULL, "latitude" DOUBLE PRECISION NOT NULL, "longitude" DOUBLE PRECISION NOT NULL,
  "accuracyM" DOUBLE PRECISION, "speedKmph" DOUBLE PRECISION, "heading" DOUBLE PRECISION,
  "batteryPct" INTEGER, "recordedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolTripPoint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SchoolVehicle_shopId_idx" ON "SchoolVehicle"("shopId");
CREATE INDEX IF NOT EXISTS "SchoolVehicle_shopId_isActive_idx" ON "SchoolVehicle"("shopId", "isActive");
CREATE INDEX IF NOT EXISTS "SchoolVehicle_driverId_idx" ON "SchoolVehicle"("driverId");
CREATE INDEX IF NOT EXISTS "SchoolTransportRoute_shopId_idx" ON "SchoolTransportRoute"("shopId");
CREATE INDEX IF NOT EXISTS "SchoolTransportRoute_shopId_isActive_idx" ON "SchoolTransportRoute"("shopId", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "SchoolTrackingLink_token_key" ON "SchoolTrackingLink"("token");
CREATE INDEX IF NOT EXISTS "SchoolTrackingLink_shopId_idx" ON "SchoolTrackingLink"("shopId");
CREATE INDEX IF NOT EXISTS "SchoolTrackingLink_vehicleId_idx" ON "SchoolTrackingLink"("vehicleId");
CREATE INDEX IF NOT EXISTS "SchoolTrackingLink_routeId_idx" ON "SchoolTrackingLink"("routeId");
CREATE INDEX IF NOT EXISTS "SchoolTrip_shopId_status_idx" ON "SchoolTrip"("shopId", "status");
CREATE INDEX IF NOT EXISTS "SchoolTrip_vehicleId_status_idx" ON "SchoolTrip"("vehicleId", "status");
CREATE INDEX IF NOT EXISTS "SchoolTrip_driverId_status_idx" ON "SchoolTrip"("driverId", "status");
CREATE INDEX IF NOT EXISTS "SchoolTrip_startedAt_idx" ON "SchoolTrip"("startedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "SchoolTrip_one_running_per_vehicle" ON "SchoolTrip"("vehicleId") WHERE "status" = 'RUNNING';
CREATE UNIQUE INDEX IF NOT EXISTS "SchoolTrip_one_running_per_driver" ON "SchoolTrip"("driverId") WHERE "status" = 'RUNNING';
CREATE INDEX IF NOT EXISTS "SchoolTripPoint_tripId_recordedAt_idx" ON "SchoolTripPoint"("tripId", "recordedAt");
CREATE INDEX IF NOT EXISTS "SchoolTripPoint_shopId_receivedAt_idx" ON "SchoolTripPoint"("shopId", "receivedAt");
CREATE INDEX IF NOT EXISTS "SchoolTripPoint_vehicleId_receivedAt_idx" ON "SchoolTripPoint"("vehicleId", "receivedAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SchoolVehicle_shopId_fkey' AND conrelid='"SchoolVehicle"'::regclass) THEN ALTER TABLE "SchoolVehicle" ADD CONSTRAINT "SchoolVehicle_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SchoolVehicle_driverId_fkey' AND conrelid='"SchoolVehicle"'::regclass) THEN ALTER TABLE "SchoolVehicle" ADD CONSTRAINT "SchoolVehicle_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SchoolTransportRoute_shopId_fkey' AND conrelid='"SchoolTransportRoute"'::regclass) THEN ALTER TABLE "SchoolTransportRoute" ADD CONSTRAINT "SchoolTransportRoute_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SchoolTrackingLink_shopId_fkey' AND conrelid='"SchoolTrackingLink"'::regclass) THEN ALTER TABLE "SchoolTrackingLink" ADD CONSTRAINT "SchoolTrackingLink_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SchoolTrackingLink_vehicleId_fkey' AND conrelid='"SchoolTrackingLink"'::regclass) THEN ALTER TABLE "SchoolTrackingLink" ADD CONSTRAINT "SchoolTrackingLink_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "SchoolVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SchoolTrackingLink_routeId_fkey' AND conrelid='"SchoolTrackingLink"'::regclass) THEN ALTER TABLE "SchoolTrackingLink" ADD CONSTRAINT "SchoolTrackingLink_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "SchoolTransportRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SchoolTrip_shopId_fkey' AND conrelid='"SchoolTrip"'::regclass) THEN ALTER TABLE "SchoolTrip" ADD CONSTRAINT "SchoolTrip_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SchoolTrip_vehicleId_fkey' AND conrelid='"SchoolTrip"'::regclass) THEN ALTER TABLE "SchoolTrip" ADD CONSTRAINT "SchoolTrip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "SchoolVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SchoolTrip_routeId_fkey' AND conrelid='"SchoolTrip"'::regclass) THEN ALTER TABLE "SchoolTrip" ADD CONSTRAINT "SchoolTrip_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "SchoolTransportRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SchoolTrip_driverId_fkey' AND conrelid='"SchoolTrip"'::regclass) THEN ALTER TABLE "SchoolTrip" ADD CONSTRAINT "SchoolTrip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SchoolTripPoint_shopId_fkey' AND conrelid='"SchoolTripPoint"'::regclass) THEN ALTER TABLE "SchoolTripPoint" ADD CONSTRAINT "SchoolTripPoint_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SchoolTripPoint_tripId_fkey' AND conrelid='"SchoolTripPoint"'::regclass) THEN ALTER TABLE "SchoolTripPoint" ADD CONSTRAINT "SchoolTripPoint_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "SchoolTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SchoolTripPoint_vehicleId_fkey' AND conrelid='"SchoolTripPoint"'::regclass) THEN ALTER TABLE "SchoolTripPoint" ADD CONSTRAINT "SchoolTripPoint_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "SchoolVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SchoolTripPoint_driverId_fkey' AND conrelid='"SchoolTripPoint"'::regclass) THEN ALTER TABLE "SchoolTripPoint" ADD CONSTRAINT "SchoolTripPoint_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF;
END $$;
