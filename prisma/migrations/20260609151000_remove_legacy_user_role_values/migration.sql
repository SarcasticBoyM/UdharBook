ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;

CREATE TYPE "UserRole_fixed" AS ENUM (
  'SUPER_ADMIN',
  'SHOP_ADMIN',
  'SALES_PERSON',
  'ACCOUNT_STAFF',
  'SALES_PERSON_CUM_ACCOUNTS'
);

ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "UserRole_fixed"
  USING (
    CASE "role"::text
      WHEN 'SUPER_ADMIN' THEN 'SUPER_ADMIN'
      WHEN 'SHOP_ADMIN' THEN 'SHOP_ADMIN'
      WHEN 'SHOP_OWNER_ADMIN' THEN 'SHOP_ADMIN'
      WHEN 'ADMIN' THEN 'SHOP_ADMIN'
      WHEN 'SALES_PERSON' THEN 'SALES_PERSON'
      WHEN 'FIELD_SALES' THEN 'SALES_PERSON'
      WHEN 'FIELD_STAFF' THEN 'SALES_PERSON'
      WHEN 'FIELD_SALES_PERSON' THEN 'SALES_PERSON'
      WHEN 'SALES' THEN 'SALES_PERSON'
      WHEN 'ACCOUNT_STAFF' THEN 'ACCOUNT_STAFF'
      WHEN 'STAFF' THEN 'ACCOUNT_STAFF'
      WHEN 'ACCOUNTING' THEN 'ACCOUNT_STAFF'
      WHEN 'ACCOUNTING_STAFF' THEN 'ACCOUNT_STAFF'
      WHEN 'ACCOUNTS' THEN 'ACCOUNT_STAFF'
      WHEN 'SALES_PERSON_CUM_ACCOUNTS' THEN 'SALES_PERSON_CUM_ACCOUNTS'
      WHEN 'FIELD_SALES_AND_ACCOUNTING' THEN 'SALES_PERSON_CUM_ACCOUNTS'
      WHEN 'SALES_AND_ACCOUNTS' THEN 'SALES_PERSON_CUM_ACCOUNTS'
      WHEN 'SALES_PERSON_AND_ACCOUNT_STAFF' THEN 'SALES_PERSON_CUM_ACCOUNTS'
      ELSE 'ACCOUNT_STAFF'
    END
  )::"UserRole_fixed";

-- A temporary pre-wipe backup schema may still have a role column backed by
-- public."UserRole". Preserve that backup data as text so the legacy enum can
-- be removed without touching the active public."User" table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute attribute
    JOIN pg_class relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'cleanup_backup_20260606_before_wipe'
      AND relation.relname = 'User'
      AND attribute.attname = 'role'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.atttypid = to_regtype('public."UserRole"')
  ) THEN
    EXECUTE 'ALTER TABLE cleanup_backup_20260606_before_wipe."User" ALTER COLUMN "role" DROP DEFAULT';
    EXECUTE 'ALTER TABLE cleanup_backup_20260606_before_wipe."User" ALTER COLUMN "role" TYPE text USING "role"::text';
  END IF;
END
$$;

-- PostgreSQL will refuse this non-CASCADE drop if any unexpected dependency
-- remains, keeping unrelated production objects safe.
DROP TYPE "UserRole";
ALTER TYPE "UserRole_fixed" RENAME TO "UserRole";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'ACCOUNT_STAFF';
