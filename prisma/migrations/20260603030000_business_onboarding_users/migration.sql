-- UdharBook business onboarding and user administration hardening.

ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "email" TEXT;

INSERT INTO "Shop" ("id", "name", "ownerName", "email", "subscriptionStatus")
VALUES ('platform-shop', 'UdharBook Platform', 'UdharBook', NULL, 'ACTIVE')
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "disabledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordResetRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tempPasswordExpiresAt" TIMESTAMP(3);

UPDATE "User" SET "shopId" = 'platform-shop' WHERE "shopId" IS NULL;
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_shopId_fkey";
ALTER TABLE "User" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "User_disabledAt_idx" ON "User"("disabledAt");
CREATE INDEX IF NOT EXISTS "Shop_email_idx" ON "Shop"("email");
