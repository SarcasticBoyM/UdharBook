# Multi-Shop Setup

UdharBook now supports multiple isolated shops/businesses.

## Roles

- `SUPER_ADMIN`: can create shops, switch between shops, and monitor all tenants.
- `SHOP_ADMIN`: manages one assigned shop.
- `STAFF`: works inside one assigned shop.

## Database Migration

Run:

```bash
npm run prisma:migrate:deploy
npm run prisma:generate
```

Existing data is assigned to `UdharBook Default Shop` during migration.

## Seed Users

Shop admin:

```bash
ADMIN_EMAIL="owner@example.com" ADMIN_PASSWORD="strong-password" npm run prisma:seed
```

Optional Super Admin:

```bash
SUPER_ADMIN_EMAIL="super@example.com" SUPER_ADMIN_PASSWORD="strong-password" npm run prisma:seed
```

Optional staff user:

```bash
STAFF_PASSWORD="strong-password" npm run prisma:seed
```

## Shop Switching

Super Admins see a shop selector in the sidebar. The selected shop is stored in a secure same-site cookie and all dashboard, customer, payment, follow-up, import, export, report, and notification APIs use that shop scope.

