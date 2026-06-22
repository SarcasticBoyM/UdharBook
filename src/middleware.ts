import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { canAccessTasks, normalizeFixedRole } from "@/lib/operational-roles";

const COOKIE_NAME = "udharbook_session";
const PUBLIC = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/api/auth/login",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/health",
  "/api/debug/auth-health",
  "/vcard",
  "/track/driver",
  "/api/public/driver-location",
  "/manifest.webmanifest",
  "/sw.js",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
];

const SUPER_ADMIN_BLOCKED_PAGES = [
  "/today-follow-ups",
  "/customers",
  "/cheques",
  "/field-staff",
  "/live-tracking",
  "/daily-visits",
  "/upload",
  "/orders",
  "/follow-ups",
  "/reports",
];

const SUPER_ADMIN_BLOCKED_APIS = [
  "/api/bulk",
  "/api/cheque-deposit-accounts",
  "/api/cheques",
  "/api/customers",
  "/api/dashboard/stats",
  "/api/field-staff",
  "/api/follow-up-reports",
  "/api/follow-ups",
  "/api/notifications",
  "/api/orders",
  "/api/reports",
  "/api/today-follow-ups",
];

const SALES_HOME = "/field-staff";
const DRIVER_HOME = "/driver-trip";

function normalizeRole(role?: string) {
  return role ? String(normalizeFixedRole(role)) : role;
}

function pathStarts(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function canAccessPage(role: string, pathname: string) {
  const normalized = normalizeRole(role);
  if (pathname === "/tasks" || pathname.startsWith("/tasks/")) return canAccessTasks(normalized ?? "");
  if (normalized === "DRIVER") return pathname === DRIVER_HOME;
  if (normalized === "SUPER_ADMIN") return !SUPER_ADMIN_BLOCKED_PAGES.some((prefix) => pathname.startsWith(prefix));
  if (normalized === "SHOP_ADMIN") return !pathname.startsWith("/shops");
  if (normalized === "SALES_PERSON") {
    return pathStarts(pathname, ["/orders", "/cheques", "/customers", "/today-follow-ups", "/field-staff", "/daily-visits", "/qrvcard"]) && !pathname.startsWith("/customers/new");
  }
  if (normalized === "ACCOUNT_STAFF") {
    return pathStarts(pathname, ["/", "/customers", "/upload", "/today-follow-ups", "/orders", "/cheques", "/reports", "/qrvcard"]) &&
      !pathStarts(pathname, ["/staff", "/shops", "/field-staff", "/daily-visits", "/live-tracking", "/follow-ups", "/customers/new"]);
  }
  if (normalized === "SALES_PERSON_CUM_ACCOUNTS") {
    return pathStarts(pathname, ["/", "/customers", "/upload", "/today-follow-ups", "/orders", "/cheques", "/field-staff", "/daily-visits", "/reports", "/qrvcard"]) &&
      !pathStarts(pathname, ["/staff", "/shops", "/live-tracking", "/follow-ups", "/customers/new"]);
  }
  return false;
}

function canAccessApi(role: string, pathname: string) {
  const normalized = normalizeRole(role);
  if (pathname === "/api/tasks" || pathname.startsWith("/api/tasks/")) return canAccessTasks(normalized ?? "");
  if (pathname === "/api/notifications" || pathname.startsWith("/api/notifications/")) return canAccessTasks(normalized ?? "");
  if (normalized === "DRIVER") return pathStarts(pathname, ["/api/auth", "/api/driver"]);
  if (normalized === "SUPER_ADMIN") return !SUPER_ADMIN_BLOCKED_APIS.some((prefix) => pathname.startsWith(prefix));
  if (normalized === "SHOP_ADMIN") return !pathname.startsWith("/api/shops") && !pathname.startsWith("/api/onboarding");
  if (normalized === "SALES_PERSON") {
    return pathStarts(pathname, ["/api/auth", "/api/orders", "/api/cheques", "/api/customers/search", "/api/customers", "/api/follow-ups", "/api/today-follow-ups"]) &&
      !pathStarts(pathname, ["/api/customers/import", "/api/customers/new", "/api/reports", "/api/users", "/api/dashboard"]);
  }
  if (normalized === "ACCOUNT_STAFF") {
    return pathStarts(pathname, ["/api/auth", "/api/customers", "/api/bulk", "/api/follow-ups", "/api/follow-up-reports", "/api/today-follow-ups", "/api/orders", "/api/cheques", "/api/cheque-deposit-accounts", "/api/reports", "/api/dashboard", "/api/qrvcard"]) &&
      !pathStarts(pathname, ["/api/users", "/api/field-staff", "/api/shops", "/api/onboarding"]);
  }
  if (normalized === "SALES_PERSON_CUM_ACCOUNTS") {
    return pathStarts(pathname, ["/api/auth", "/api/customers", "/api/bulk", "/api/follow-ups", "/api/follow-up-reports", "/api/today-follow-ups", "/api/orders", "/api/cheques", "/api/cheque-deposit-accounts", "/api/reports", "/api/dashboard", "/api/qrvcard", "/api/field-staff"]) &&
      !pathStarts(pathname, ["/api/users", "/api/shops", "/api/onboarding"]);
  }
  return false;
}

function logMiddleware(level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) {
  const payload = JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  });
  if (level === "error") {
    console.error(payload);
  } else if (level === "warn") {
    console.warn(payload);
  } else {
    console.info(payload);
  }
}

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 24) {
    throw new Error("SESSION_SECRET is missing or too short");
  }
  return new TextEncoder().encode(secret);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const traceId = crypto.randomUUID();

  if (
    pathname === "/api/notifications/due" &&
    process.env.CRON_SECRET &&
    request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.next();
  }

  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) {
      return secure(NextResponse.json({ error: "Invalid origin" }, { status: 403 }));
    }
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    logMiddleware("warn", "middleware_missing_session_cookie", {
      traceId,
      path: pathname,
      method: request.method,
      isApi: pathname.startsWith("/api/"),
      host: request.headers.get("host"),
      proto: request.headers.get("x-forwarded-proto"),
    });
    if (pathname.startsWith("/api/")) {
      return secure(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }
    return secure(NextResponse.redirect(new URL("/login", request.url)));
  }

  try {
    logMiddleware("info", "middleware_session_decode_start", {
      traceId,
      path: pathname,
      method: request.method,
      cookiePresent: true,
      cookieLength: token.length,
      sessionSecretPresent: Boolean(process.env.SESSION_SECRET),
      sessionSecretLengthOk: Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 24),
    });
    const { payload } = await jwtVerify(token, getSecret());
    const role = normalizeRole(payload.role as string | undefined);
    const shopId = payload.shopId as string | undefined;
    const userId = payload.id as string | undefined;
    logMiddleware("info", "middleware_session_decode_success", { traceId, path: pathname, userId, role, shopId });

    if (!role) {
      logMiddleware("warn", "middleware_reject_missing_role", { traceId, path: pathname, userId, shopId });
      if (pathname.startsWith("/api/")) {
        return clearSessionCookie(secure(NextResponse.json({ error: "Unauthorized" }, { status: 401 })));
      }
      return clearSessionCookie(secure(NextResponse.redirect(new URL("/login", request.url))));
    }

    if (role === "SUPER_ADMIN" && SUPER_ADMIN_BLOCKED_PAGES.some((prefix) => pathname.startsWith(prefix))) {
      logMiddleware("warn", "middleware_redirect_super_admin_business_page_blocked", { traceId, path: pathname, userId, role, shopId });
      return secure(NextResponse.redirect(new URL("/", request.url)));
    }
    if (role === "SUPER_ADMIN" && SUPER_ADMIN_BLOCKED_APIS.some((prefix) => pathname.startsWith(prefix))) {
      logMiddleware("warn", "middleware_reject_super_admin_business_api_blocked", { traceId, path: pathname, userId, role, shopId });
      return secure(NextResponse.json({ error: "Super admin business data access requires temporary support access" }, { status: 403 }));
    }

    if (pathname.startsWith("/shops") && role !== "SUPER_ADMIN") {
      logMiddleware("warn", "middleware_redirect_shops_forbidden", { traceId, path: pathname, userId, role, shopId });
      return secure(NextResponse.redirect(new URL("/", request.url)));
    }
    if (pathname.startsWith("/api/shops") && role !== "SUPER_ADMIN") {
      logMiddleware("warn", "middleware_reject_api_shops_forbidden", { traceId, path: pathname, userId, role, shopId });
      return secure(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    }
    if (pathname.startsWith("/api/onboarding") && role !== "SUPER_ADMIN") {
      logMiddleware("warn", "middleware_reject_api_onboarding_forbidden", { traceId, path: pathname, userId, role, shopId });
      return secure(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    }

    if (role === "SALES_PERSON" && pathname === "/") {
      logMiddleware("info", "middleware_redirect_sales_home", { traceId, path: pathname, userId, role, shopId });
      return secure(NextResponse.redirect(new URL(SALES_HOME, request.url)));
    }
    if (role === "DRIVER" && pathname === "/") {
      logMiddleware("info", "middleware_redirect_driver_home", { traceId, path: pathname, userId, role, shopId });
      return secure(NextResponse.redirect(new URL(DRIVER_HOME, request.url)));
    }
    if (pathname.startsWith("/api/") && !canAccessApi(role, pathname)) {
      logMiddleware("warn", "middleware_reject_api_forbidden", { traceId, path: pathname, userId, role, shopId });
      return secure(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    }
    if (!pathname.startsWith("/api/") && !canAccessPage(role, pathname)) {
      logMiddleware("warn", "middleware_redirect_page_forbidden", { traceId, path: pathname, userId, role, shopId });
      const home = role === "SALES_PERSON" ? SALES_HOME : role === "DRIVER" ? DRIVER_HOME : "/";
      return secure(NextResponse.redirect(new URL(home, request.url)));
    }
    if (role !== "SUPER_ADMIN" && !shopId) {
      logMiddleware("error", "middleware_redirect_missing_shop_id", { traceId, path: pathname, userId, role });
      return secure(NextResponse.redirect(new URL("/login", request.url)));
    }
    if (role === "SUPER_ADMIN" && !shopId) {
      logMiddleware("warn", "middleware_super_admin_missing_shop_id_non_blocking", { traceId, path: pathname, userId, role });
    }

    logMiddleware("info", "middleware_session_validated", { traceId, path: pathname, userId, role, shopId });
    return secure(NextResponse.next());
  } catch (error) {
    logMiddleware("warn", "middleware_session_decode_failed", {
      traceId,
      path: pathname,
      error: error instanceof Error ? error.message : "Unknown middleware auth error",
      stack: error instanceof Error ? error.stack : undefined,
      hasSessionSecret: Boolean(process.env.SESSION_SECRET),
      sessionSecretLength: process.env.SESSION_SECRET?.length ?? 0,
    });
    if (pathname.startsWith("/api/")) {
      return clearSessionCookie(secure(NextResponse.json({ error: "Unauthorized" }, { status: 401 })));
    }
    return clearSessionCookie(secure(NextResponse.redirect(new URL("/login", request.url))));
  }
}

function clearSessionCookie(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}

function secure(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=(self)");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
