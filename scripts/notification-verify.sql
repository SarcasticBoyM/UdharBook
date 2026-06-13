-- Read-only structure checks plus rollback-only write verification.

SELECT table_name, column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('Notification', 'NotificationRetry')
ORDER BY table_name, ordinal_position;

SELECT typ.typname AS enum_name, enum.enumlabel AS enum_value
FROM pg_type typ
JOIN pg_enum enum ON enum.enumtypid = typ.oid
JOIN pg_namespace ns ON ns.oid = typ.typnamespace
WHERE ns.nspname = 'public'
  AND typ.typname IN ('NotificationTargetType', 'NotificationPriority', 'NotificationRetryStatus')
ORDER BY typ.typname, enum.enumsortorder;

SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('Notification', 'NotificationRetry')
ORDER BY tablename, indexname;

SELECT rel.relname AS table_name, con.conname AS constraint_name, con.contype AS constraint_type
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = rel.relnamespace
WHERE ns.nspname = 'public'
  AND rel.relname IN ('Notification', 'NotificationRetry')
ORDER BY rel.relname, con.conname;

SELECT "id", "type", "priority", "createdAt" FROM "Notification" LIMIT 1;
SELECT "id", "eventType", "status", "nextRetryAt" FROM "NotificationRetry" LIMIT 1;

BEGIN;
DO $$
DECLARE
  verification_shop_id TEXT;
  verification_notification_id TEXT := 'notification-storage-rollback-check';
BEGIN
  SELECT "id" INTO verification_shop_id FROM "Shop" ORDER BY "createdAt" LIMIT 1;
  IF verification_shop_id IS NULL THEN
    RAISE NOTICE 'No shop exists; rollback insert test skipped.';
    RETURN;
  END IF;

  INSERT INTO "Notification" (
    "id", "shopId", "targetType", "type", "title", "message",
    "entityType", "entityId", "idempotencyKey", "priority"
  ) VALUES (
    verification_notification_id, verification_shop_id, 'SHOP',
    'STORAGE_VERIFY', 'Storage verification', 'Rollback-only verification row',
    'GENERAL', verification_notification_id,
    verification_shop_id || ':STORAGE_VERIFY:GENERAL:' || verification_notification_id || ':SHOP',
    'NORMAL'
  );

  INSERT INTO "NotificationRetry" (
    "id", "shopId", "eventType", "entityType", "entityId",
    "idempotencyKey", "payload", "nextRetryAt", "status"
  ) VALUES (
    'notification-retry-rollback-check', verification_shop_id, 'STORAGE_VERIFY',
    'GENERAL', verification_notification_id,
    verification_shop_id || ':STORAGE_VERIFY:GENERAL:' || verification_notification_id || ':RETRY',
    '{}'::jsonb, CURRENT_TIMESTAMP, 'PENDING'
  );
END
$$;
ROLLBACK;

SELECT
  (SELECT COUNT(*) FROM "Notification" WHERE "id" = 'notification-storage-rollback-check') AS notification_rows_after_rollback,
  (SELECT COUNT(*) FROM "NotificationRetry" WHERE "id" = 'notification-retry-rollback-check') AS retry_rows_after_rollback;
