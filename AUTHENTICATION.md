# Authentication System

This document explains the authentication and authorization system.

## Overview

The application uses:
- **JWT tokens** for session management
- **HttpOnly cookies** for secure token storage
- **Password hashing** with bcrypt (salting cost: 12)
- **Role-based access control** (RBAC) for authorization

## Authentication Flow

### Login Process

1. User enters credentials
2. POST /api/auth/login
3. Validate email and password
4. Generate JWT token (7-day expiration)
5. Set HttpOnly secure cookie
6. Redirect to dashboard

### Protected Routes

All routes under `/(dashboard)` require authentication via middleware.

**Middleware checks:**
1. Verify JWT token in `pf_session` cookie
2. Validate token signature using SESSION_SECRET
3. Check token expiration (7 days)
4. Redirect to `/login` if invalid

**Public routes (no auth required):**
- `/login` - Login page
- `/api/auth/login` - Login endpoint

### Logout Process

```bash
POST /api/auth/logout
```

## Authorization System

### Roles

**ADMIN Role:**
- Full application access
- User management (create, reset, delete users)
- Excel file upload
- View all reports
- Access `/admin/users`

**STAFF Role:**
- Dashboard (read-only)
- Customer management (view/create)
- Follow-up tracking (create/manage)
- Reports (view only)
- No user management access

## Session Management

### Session Data

Each JWT token contains:
```json
{
  "id": "user-id",
  "name": "Full Name",
  "email": "user@example.com",
  "role": "ADMIN"
}
```

### Session Expiration

- **Duration**: 7 days
- **Auto-refresh**: None (user must log in again)
- **Storage**: HttpOnly cookie (secure, not accessible to JS)

## Password Security

### Hashing

Passwords are hashed using bcrypt with:
- **Algorithm**: bcrypt (adaptive)
- **Salting cost**: 12 rounds
- **Stored**: `passwordHash` field (never plaintext)

### Password Reset

Admin can reset user passwords via `/api/admin/users/[id]`

**Security notes:**
- New password must be 8+ characters
- Old password NOT required (admin initiated)
- User must log in with new password

## Default Admin Setup

### Initial Deployment

On first run, seed the database:

```bash
npm run db:seed
```

**Created users:**
- Email: `admin@shop.local` / Password: `admin123` (ADMIN)
- Email: `staff@shop.local` / Password: `staff123` (STAFF)

### Production Setup

**Change demo passwords immediately:**

1. Log in as admin
2. Go to `/admin/users`
3. Reset both user passwords
4. Distribute new credentials securely

## Security Best Practices

### For Administrators

1. ✅ Change default passwords immediately
2. ✅ Use strong passwords (12+ chars, mixed case, numbers, symbols)
3. ✅ Rotate SESSION_SECRET regularly in production
4. ✅ Monitor user access
5. ✅ Delete inactive accounts after 90 days

### For Users

1. ✅ Never share your password
2. ✅ Log out when finished (especially on shared devices)
3. ✅ Use unique password (not used elsewhere)
4. ✅ Report suspicious activity to admin

### For Developers

1. ✅ Never commit secrets (.env files, API keys)
2. ✅ Use environment variables for all secrets
3. ✅ Rotate SESSION_SECRET in production
4. ✅ Keep dependencies updated (npm audit)
5. ✅ Review admin routes for authorization checks
6. ✅ Test authentication before deployment
7. ✅ Use HTTPS only in production

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `SESSION_SECRET` | JWT encryption key | ✅ Yes |
| `NODE_ENV` | Runtime environment | Auto |
| `DATABASE_URL` | Database connection | ✅ Yes |

---

For more details, see the full [AUTHENTICATION.md](./AUTHENTICATION.md) in the repository.
