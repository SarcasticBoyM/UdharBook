-- These tables are accessed only by UdharBook's server-side Prisma/API code.
-- Supabase anon/authenticated clients must not have direct table access.
--
-- FORCE ROW LEVEL SECURITY is intentionally not enabled:
--   * Prisma connects as the table owner (`postgres`) in production.
--   * Supabase `service_role` has BYPASSRLS.
-- Both server paths therefore keep their existing behavior without a broad
-- client-visible policy.
--
-- No RLS policies are created. With RLS enabled, non-owner/non-BYPASSRLS
-- roles are default-denied, and the explicit grants below remove public CRUD.

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Order',
    'PushSubscription',
    'PushDelivery',
    'NotificationRetry',
    'SupportAccessGrant',
    'UserRoleAssignment'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', table_name);

      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', table_name);
      END IF;

      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', table_name);
      END IF;
    END IF;
  END LOOP;
END $$;
