-- UdharBook production data cleanup
-- Date prepared: 2026-06-06
--
-- Run from Supabase SQL Editor only after taking a Supabase project backup.
-- This script deletes rows only. It does not drop tables, migrations, schema,
-- enums, indexes, policies, or app configuration.
--
-- Important:
-- - The current schema requires every User, including SUPER_ADMIN, to reference a Shop.
-- - Therefore this preserves platform-shop and any shop referenced by a SUPER_ADMIN.
-- - All non-SUPER_ADMIN users and tenant/business data are deleted.

BEGIN;

-- Keep a database-side row snapshot before cleanup.
CREATE SCHEMA IF NOT EXISTS cleanup_backup_20260606_before_wipe;

CREATE TABLE cleanup_backup_20260606_before_wipe."Shop" AS TABLE public."Shop";
CREATE TABLE cleanup_backup_20260606_before_wipe."User" AS TABLE public."User";
CREATE TABLE cleanup_backup_20260606_before_wipe."Customer" AS TABLE public."Customer";
CREATE TABLE cleanup_backup_20260606_before_wipe."FollowUp" AS TABLE public."FollowUp";
CREATE TABLE cleanup_backup_20260606_before_wipe."StatusHistory" AS TABLE public."StatusHistory";
CREATE TABLE cleanup_backup_20260606_before_wipe."PaymentEntry" AS TABLE public."PaymentEntry";
CREATE TABLE cleanup_backup_20260606_before_wipe."CustomerNote" AS TABLE public."CustomerNote";
CREATE TABLE cleanup_backup_20260606_before_wipe."ActivityLog" AS TABLE public."ActivityLog";
CREATE TABLE cleanup_backup_20260606_before_wipe."PasswordResetToken" AS TABLE public."PasswordResetToken";
CREATE TABLE cleanup_backup_20260606_before_wipe."Cheque" AS TABLE public."Cheque";
CREATE TABLE cleanup_backup_20260606_before_wipe."ChequeActivity" AS TABLE public."ChequeActivity";
CREATE TABLE cleanup_backup_20260606_before_wipe."ChequeDepositAccount" AS TABLE public."ChequeDepositAccount";
CREATE TABLE cleanup_backup_20260606_before_wipe."StaffLocation" AS TABLE public."StaffLocation";
CREATE TABLE cleanup_backup_20260606_before_wipe."Attendance" AS TABLE public."Attendance";
CREATE TABLE cleanup_backup_20260606_before_wipe."StaffVisit" AS TABLE public."StaffVisit";
CREATE TABLE cleanup_backup_20260606_before_wipe."VisitPhoto" AS TABLE public."VisitPhoto";
CREATE TABLE cleanup_backup_20260606_before_wipe."RouteHistory" AS TABLE public."RouteHistory";

-- Safety gate: do not continue if there is no active SUPER_ADMIN.
DO $$
DECLARE
  super_admin_count integer;
BEGIN
  SELECT COUNT(*)
  INTO super_admin_count
  FROM public."User"
  WHERE role = 'SUPER_ADMIN'::public."UserRole"
    AND "disabledAt" IS NULL;

  IF super_admin_count < 1 THEN
    RAISE EXCEPTION 'Cleanup aborted: no active SUPER_ADMIN user found.';
  END IF;
END $$;

-- File/storage paths to remove separately from Supabase Storage buckets.
-- Export these result rows before COMMIT if you need an external deletion list.
CREATE TABLE cleanup_backup_20260606_before_wipe.storage_object_paths AS
SELECT 'cheque_front_image' AS source, "frontImageUrl" AS path
FROM public."Cheque"
WHERE "frontImageUrl" IS NOT NULL AND "frontImageUrl" <> ''
UNION ALL
SELECT 'cheque_back_image', "backImageUrl"
FROM public."Cheque"
WHERE "backImageUrl" IS NOT NULL AND "backImageUrl" <> ''
UNION ALL
SELECT 'cheque_deposit_slip', "depositSlipUrl"
FROM public."Cheque"
WHERE "depositSlipUrl" IS NOT NULL AND "depositSlipUrl" <> ''
UNION ALL
SELECT 'cheque_deposit_receipt', "depositReceiptUrl"
FROM public."Cheque"
WHERE "depositReceiptUrl" IS NOT NULL AND "depositReceiptUrl" <> ''
UNION ALL
SELECT 'visit_photo', url
FROM public."VisitPhoto"
WHERE url IS NOT NULL AND url <> '';

-- Delete logs, queues, reminders, notifications, tracking, reports, and tenant data.
DELETE FROM public."ActivityLog";
DELETE FROM public."PasswordResetToken";
DELETE FROM public."ChequeActivity";
DELETE FROM public."VisitPhoto";
DELETE FROM public."StaffLocation";
DELETE FROM public."Attendance";
DELETE FROM public."RouteHistory";
DELETE FROM public."Cheque";
DELETE FROM public."StaffVisit";
DELETE FROM public."FollowUp";
DELETE FROM public."StatusHistory";
DELETE FROM public."PaymentEntry";
DELETE FROM public."CustomerNote";
DELETE FROM public."ChequeDepositAccount";
DELETE FROM public."Customer";

-- Remove all staff/shop-admin/test/demo users. Preserve only SUPER_ADMIN users.
DELETE FROM public."User"
WHERE role <> 'SUPER_ADMIN'::public."UserRole";

-- Ensure any remaining SUPER_ADMIN is attached to platform-shop when it exists.
UPDATE public."User"
SET "shopId" = 'platform-shop'
WHERE role = 'SUPER_ADMIN'::public."UserRole"
  AND EXISTS (SELECT 1 FROM public."Shop" WHERE id = 'platform-shop');

-- Remove all real tenant shops. Keep only the platform holder shop(s) needed by SUPER_ADMIN.
DELETE FROM public."Shop"
WHERE id NOT IN (
  SELECT DISTINCT "shopId"
  FROM public."User"
  WHERE role = 'SUPER_ADMIN'::public."UserRole"
)
AND id <> 'platform-shop';

-- Reset any real sequences, if future migrations added sequence-backed columns.
DO $$
DECLARE
  seq record;
BEGIN
  FOR seq IN
    SELECT schemaname, sequencename
    FROM pg_sequences
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I RESTART WITH 1', seq.schemaname, seq.sequencename);
  END LOOP;
END $$;

-- Verification snapshot. Expected:
-- shop_count >= 1 only because SUPER_ADMIN requires a platform shop.
-- super_admin_count >= 1.
-- all tenant/log/history counts = 0.
CREATE TEMP TABLE cleanup_verification AS
SELECT
  (SELECT COUNT(*) FROM public."Shop") AS shop_count,
  (SELECT COUNT(*) FROM public."User" WHERE role = 'SUPER_ADMIN'::public."UserRole") AS super_admin_count,
  (SELECT COUNT(*) FROM public."User" WHERE role <> 'SUPER_ADMIN'::public."UserRole") AS non_super_admin_user_count,
  (SELECT COUNT(*) FROM public."Customer") AS customer_count,
  (SELECT COUNT(*) FROM public."FollowUp") AS followup_count,
  (SELECT COUNT(*) FROM public."Cheque") AS cheque_count,
  (SELECT COUNT(*) FROM public."StaffVisit") AS staff_visit_count,
  (SELECT COUNT(*) FROM public."StaffLocation") AS staff_location_count,
  (SELECT COUNT(*) FROM public."ActivityLog") AS activity_log_count,
  (SELECT COUNT(*) FROM public."PaymentEntry") AS payment_count,
  (SELECT COUNT(*) FROM public."CustomerNote") AS customer_note_count,
  (SELECT COUNT(*) FROM public."VisitPhoto") AS visit_photo_count,
  (SELECT COUNT(*) FROM cleanup_backup_20260606_before_wipe.storage_object_paths) AS storage_paths_to_delete;

DO $$
DECLARE
  failures integer;
BEGIN
  SELECT
    CASE WHEN super_admin_count < 1 THEN 1 ELSE 0 END +
    CASE WHEN non_super_admin_user_count <> 0 THEN 1 ELSE 0 END +
    CASE WHEN customer_count <> 0 THEN 1 ELSE 0 END +
    CASE WHEN followup_count <> 0 THEN 1 ELSE 0 END +
    CASE WHEN cheque_count <> 0 THEN 1 ELSE 0 END +
    CASE WHEN staff_visit_count <> 0 THEN 1 ELSE 0 END +
    CASE WHEN staff_location_count <> 0 THEN 1 ELSE 0 END +
    CASE WHEN activity_log_count <> 0 THEN 1 ELSE 0 END +
    CASE WHEN payment_count <> 0 THEN 1 ELSE 0 END +
    CASE WHEN customer_note_count <> 0 THEN 1 ELSE 0 END +
    CASE WHEN visit_photo_count <> 0 THEN 1 ELSE 0 END
  INTO failures
  FROM cleanup_verification;

  IF failures <> 0 THEN
    RAISE EXCEPTION 'Cleanup verification failed. Transaction rolled back.';
  END IF;
END $$;

COMMIT;

SELECT *
FROM cleanup_verification;

SELECT *
FROM cleanup_backup_20260606_before_wipe.storage_object_paths
ORDER BY source, path;
