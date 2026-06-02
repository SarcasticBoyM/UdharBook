# UdharBook Admin Login

## Production

Create or update the admin account with:

```bash
ADMIN_EMAIL="owner@example.com" ADMIN_PASSWORD="long-random-password" npm run prisma:seed
```

The password is bcrypt-hashed before storage.

## Local Development

If `DATABASE_URL` is not a hosted Supabase database, the seed can use:

- Email: `admin@udharbook.local`
- Password: `admin12345`

Do not use local defaults in production.

## Password Reset

Use `/forgot-password` to create a reset token. In development, the reset link is shown on screen for testing. In production, connect the generated reset URL to your email/SMS provider.
