# Database Changes

## New Models

- `Shop`

## Updated Models

- `User` now has `shopId`, `lastLoginAt`, and roles `SUPER_ADMIN`, `SHOP_ADMIN`, `STAFF`.
- `Customer` now has `shopId` and shop-scoped unique contact numbers.
- `FollowUp` now has `shopId`, `scheduledAt`, `completedAt`, `remindedAt`, `reminderNotes`, and `customerResponse`.
- `PaymentEntry`, `CustomerNote`, and `ActivityLog` now include `shopId`.

## New Enum Values

- `SubscriptionStatus`: `TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED`
- `FollowUpStatus`: added `COMPLETED`, `MISSED`, `RESCHEDULED`

## Isolation

All business data is filtered by active shop:

- Customers
- Payments
- Follow-ups
- Reports
- Excel imports
- Notifications
- Activity logs

## Migration

Migration file:

```text
prisma/migrations/20260603020000_multi_shop_notifications/migration.sql
```

Existing records are assigned to `default-shop`.

