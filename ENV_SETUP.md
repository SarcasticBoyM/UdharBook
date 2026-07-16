# UdharBook Environment Setup

Create `.env` locally and configure the same variables in Vercel.

```env
DATABASE_URL="postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&sslmode=require"
DIRECT_URL="postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require"
SESSION_SECRET="replace-with-at-least-32-random-characters"
NEXT_PUBLIC_APP_URL="https://your-vercel-domain.vercel.app"
NEXT_PUBLIC_MAPPLS_MAP_SDK_KEY="your-mappls-static-web-sdk-key"
HIGH_BALANCE_THRESHOLD=50000
ADMIN_EMAIL="owner@example.com"
ADMIN_PASSWORD="replace-with-a-strong-admin-password"
SUPER_ADMIN_EMAIL="super@example.com"
SUPER_ADMIN_PASSWORD="replace-with-a-strong-super-admin-password"
STAFF_PASSWORD="replace-with-a-strong-staff-password"
SHOP_NAME="Your Business Name"
SHOP_OWNER_NAME="Owner Name"
SHOP_MOBILE="9999999999"
SHOP_GST="GSTIN"
SHOP_ADDRESS="Business address"
```

## Variable Guide

- `DATABASE_URL`: pooled Supabase connection used by the app at runtime.
- `DIRECT_URL`: direct Supabase connection used by Prisma migrations.
- `SESSION_SECRET`: signs UdharBook session cookies.
- `NEXT_PUBLIC_APP_URL`: used to build password reset links.
- `NEXT_PUBLIC_MAPPLS_MAP_SDK_KEY`: browser-safe Mappls static Web Maps SDK key used only by the transport map. In the Mappls console, enable Web Maps and allow your production hostname. For local development also allow `http://localhost:3000` and, if used, `http://127.0.0.1:3000`. Add the same variable to the relevant Vercel environments and redeploy. Never put a Mappls client secret in this variable.
- `HIGH_BALANCE_THRESHOLD`: dashboard high-risk outstanding threshold.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD`: used only when seeding the admin user.
- `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`: optional platform admin seed.
- `STAFF_PASSWORD`: optional demo staff seed.
- `SHOP_*`: optional default shop seed metadata.
