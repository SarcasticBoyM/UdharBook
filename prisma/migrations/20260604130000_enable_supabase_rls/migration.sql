-- Supabase Security Advisor: enable Row Level Security on every public business table.
-- UdharBook uses server-side Prisma/custom sessions. RLS is enabled for direct
-- public/Supabase API protection, while backend owner/service-role connections
-- continue to work because FORCE RLS is intentionally not enabled.

CREATE OR REPLACE FUNCTION public.udharbook_current_shop_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.shopId', true), ''),
    NULLIF(current_setting('request.jwt.claim.shop_id', true), ''),
    NULLIF((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'shopId'), ''),
    NULLIF((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'shop_id'), '')
  );
$$;

CREATE OR REPLACE FUNCTION public.udharbook_current_user_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    NULLIF(current_setting('request.jwt.claim.userId', true), ''),
    NULLIF(current_setting('request.jwt.claim.user_id', true), ''),
    NULLIF((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), ''),
    NULLIF((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'userId'), ''),
    NULLIF((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'user_id'), '')
  );
$$;

CREATE OR REPLACE FUNCTION public.udharbook_service_context()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_user IN ('postgres', 'service_role', 'supabase_admin');
$$;

ALTER TABLE IF EXISTS public."Shop" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."StaffLocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."Attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."StaffVisit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."VisitPhoto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."RouteHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."FollowUp" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."StatusHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."PaymentEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."Cheque" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."ChequeDepositAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."ChequeActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."CustomerNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."ActivityLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."PasswordResetToken" ENABLE ROW LEVEL SECURITY;

-- Direct shop-owned tables.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'User',
    'Customer',
    'StaffLocation',
    'Attendance',
    'StaffVisit',
    'VisitPhoto',
    'RouteHistory',
    'FollowUp',
    'PaymentEntry',
    'Cheque',
    'ChequeDepositAccount',
    'ChequeActivity',
    'CustomerNote'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'udharbook_shop_isolation', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I
       FOR ALL
       USING (public.udharbook_service_context() OR "shopId" = public.udharbook_current_shop_id())
       WITH CHECK (public.udharbook_service_context() OR "shopId" = public.udharbook_current_shop_id())',
      'udharbook_shop_isolation',
      table_name
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS "udharbook_shop_isolation" ON public."Shop";
CREATE POLICY "udharbook_shop_isolation" ON public."Shop"
FOR ALL
USING (public.udharbook_service_context() OR "id" = public.udharbook_current_shop_id())
WITH CHECK (public.udharbook_service_context() OR "id" = public.udharbook_current_shop_id());

DROP POLICY IF EXISTS "udharbook_activity_log_isolation" ON public."ActivityLog";
CREATE POLICY "udharbook_activity_log_isolation" ON public."ActivityLog"
FOR ALL
USING (
  public.udharbook_service_context()
  OR "shopId" = public.udharbook_current_shop_id()
  OR ("shopId" IS NULL AND "userId" = public.udharbook_current_user_id())
)
WITH CHECK (
  public.udharbook_service_context()
  OR "shopId" = public.udharbook_current_shop_id()
  OR ("shopId" IS NULL AND "userId" = public.udharbook_current_user_id())
);

DROP POLICY IF EXISTS "udharbook_status_history_isolation" ON public."StatusHistory";
CREATE POLICY "udharbook_status_history_isolation" ON public."StatusHistory"
FOR ALL
USING (
  public.udharbook_service_context()
  OR EXISTS (
    SELECT 1 FROM public."Customer" c
    WHERE c."id" = "StatusHistory"."customerId"
      AND c."shopId" = public.udharbook_current_shop_id()
  )
)
WITH CHECK (
  public.udharbook_service_context()
  OR EXISTS (
    SELECT 1 FROM public."Customer" c
    WHERE c."id" = "StatusHistory"."customerId"
      AND c."shopId" = public.udharbook_current_shop_id()
  )
);

-- Password reset tokens must never be readable through public/authenticated APIs.
-- Server-side Prisma/table owner access continues to work; anon/authenticated has no policy.
DROP POLICY IF EXISTS "udharbook_password_reset_no_public_access" ON public."PasswordResetToken";

DO $$
DECLARE
  table_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    FOREACH table_name IN ARRAY ARRAY[
      'Shop',
      'User',
      'Customer',
      'StaffLocation',
      'Attendance',
      'StaffVisit',
      'VisitPhoto',
      'RouteHistory',
      'FollowUp',
      'StatusHistory',
      'PaymentEntry',
      'Cheque',
      'ChequeDepositAccount',
      'ChequeActivity',
      'CustomerNote',
      'ActivityLog',
      'PasswordResetToken'
    ]
    LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    END LOOP;
  END IF;
END $$;
