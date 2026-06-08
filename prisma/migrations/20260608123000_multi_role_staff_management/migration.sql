CREATE TYPE "OperationalRole" AS ENUM (
  'SHOP_ADMIN',
  'ACCOUNTING_STAFF',
  'FIELD_SALES_PERSON',
  'CHEQUE_OPERATIONS',
  'ORDER_MANAGER',
  'FOLLOWUP_MANAGER'
);

CREATE TABLE "UserRoleAssignment" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "OperationalRole" NOT NULL,
  "assignedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserRoleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserRoleAssignment_userId_role_key" ON "UserRoleAssignment"("userId", "role");
CREATE INDEX "UserRoleAssignment_shopId_role_idx" ON "UserRoleAssignment"("shopId", "role");
CREATE INDEX "UserRoleAssignment_shopId_userId_idx" ON "UserRoleAssignment"("shopId", "userId");

ALTER TABLE "UserRoleAssignment"
  ADD CONSTRAINT "UserRoleAssignment_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserRoleAssignment"
  ADD CONSTRAINT "UserRoleAssignment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserRoleAssignment"
  ADD CONSTRAINT "UserRoleAssignment_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "UserRoleAssignment" ("id", "shopId", "userId", "role", "createdAt")
SELECT
  'ura_' || md5(u."id" || ':SHOP_ADMIN'),
  u."shopId",
  u."id",
  'SHOP_ADMIN'::"OperationalRole",
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."role" = 'SHOP_ADMIN'
ON CONFLICT ("userId", "role") DO NOTHING;

INSERT INTO "UserRoleAssignment" ("id", "shopId", "userId", "role", "createdAt")
SELECT
  'ura_' || md5(u."id" || ':ACCOUNTING_STAFF'),
  u."shopId",
  u."id",
  'ACCOUNTING_STAFF'::"OperationalRole",
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."role" = 'STAFF'
ON CONFLICT ("userId", "role") DO NOTHING;

INSERT INTO "UserRoleAssignment" ("id", "shopId", "userId", "role", "createdAt")
SELECT
  'ura_' || md5(u."id" || ':FIELD_SALES_PERSON'),
  u."shopId",
  u."id",
  'FIELD_SALES_PERSON'::"OperationalRole",
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."role" = 'FIELD_SALES'
ON CONFLICT ("userId", "role") DO NOTHING;
