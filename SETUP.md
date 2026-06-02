# Setup Guide

Complete setup instructions for developing and deploying the Payment Follow-up application.

## Prerequisites

- Node.js 18+ (check with `node --version`)
- npm 9+ (included with Node.js)
- Git
- A code editor (VS Code recommended)
- For Vercel deployment: GitHub account

## Quick Start (5 minutes)

### 1. Clone Repository

```bash
git clone <repository-url>
cd agents-nextjs-mobile-responsive-auth-system
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Setup Environment Variables

Create `.env.local`:

```env
DATABASE_URL="file:./dev.db"
SESSION_SECRET="dev-secret-change-in-production-min-32-chars"
HIGH_BALANCE_THRESHOLD=50000
```

### 4. Initialize Database

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database (creates tables)
npx prisma db push

# Seed demo data (optional)
npm run db:seed
```

### 5. Start Development Server

```bash
npm run dev
```

Open browser: `http://localhost:3000`

### 6. Login with Demo Credentials

- Email: `admin@shop.local`
- Password: `admin123`

Or for staff account:
- Email: `staff@shop.local`
- Password: `staff123`

## Production Deployment

For deployment instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md)

---

**Ready to develop!** 🚀
