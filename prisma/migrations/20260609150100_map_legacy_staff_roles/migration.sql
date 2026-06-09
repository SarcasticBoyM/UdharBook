UPDATE "User" u
SET role = 'SALES_PERSON_CUM_ACCOUNTS'
WHERE role = 'FIELD_SALES'
  AND EXISTS (
    SELECT 1
    FROM "UserRoleAssignment" ura
    WHERE ura."userId" = u.id
      AND ura.role IN ('ACCOUNTING_STAFF', 'CHEQUE_OPERATIONS', 'FOLLOWUP_MANAGER')
  );

UPDATE "User" u
SET role = 'SALES_PERSON_CUM_ACCOUNTS'
WHERE role = 'STAFF'
  AND EXISTS (
    SELECT 1
    FROM "UserRoleAssignment" ura
    WHERE ura."userId" = u.id
      AND ura.role = 'FIELD_SALES_PERSON'
  );

UPDATE "User"
SET role = 'SALES_PERSON'
WHERE role = 'FIELD_SALES';

UPDATE "User"
SET role = 'ACCOUNT_STAFF'
WHERE role = 'STAFF';
