# UdharBook Environment Setup

Create `.env` locally and configure the same variables in Vercel.

```env
DATABASE_URL="postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&sslmode=require"
DIRECT_URL="postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require"
SESSION_SECRET="replace-with-at-least-32-random-characters"
NEXT_PUBLIC_APP_URL="https://your-vercel-domain.vercel.app"
HIGH_BALANCE_THRESHOLD=50000
ADMIN_EMAIL="owner@example.com"
ADMIN_PASSWORD="replace-with-a-strong-admin-password"
```

## Variable Guide

- `DATABASE_URL`: pooled Supabase connection used by the app at runtime.
- `DIRECT_URL`: direct Supabase connection used by Prisma migrations.
- `SESSION_SECRET`: signs UdharBook session cookies.
- `NEXT_PUBLIC_APP_URL`: used to build password reset links.
- `HIGH_BALANCE_THRESHOLD`: dashboard high-risk outstanding threshold.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD`: used only when seeding the admin user.
