import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

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
  "/manifest.webmanifest",
  "/sw.js",
  "/icon.svg",
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

const FIELD_SALES_HOME = "/field-staff";
const FIELD_SALES_BLOCKED_PAGES = [
  "/today-follow-ups",
  "/upload",
  "/follow-ups",
  "/reports",
  "/live-tracking",
  "/shops",
  "/customers/new",
];
const FIELD_SALES_BLOCKED_APIS = [
  "/api/bulk",
  "/api/customers/import",
  "/api/dashboard/stats",
  "/api/follow-up-reports",
  "/api/follow-ups",
  "/api/onboarding",
  "/api/reports",
  "/api/shops",
  "/api/today-follow-ups",
  "/api/users",
];
const STAFF_BLOCKED_PAGES = ["/field-staff", "/daily-visits", "/orders", "/live-tracking"];
const STAFF_BLOCKED_APIS = ["/api/field-staff", "/api/orders"];
const FIELD_OPERATION_ROLES = ["FIELD_SALES_PERSON"];
const ORDER_OPERATION_ROLES = ["ORDER_MANAGER", "ACCOUNTING_STAFF", "FIELD_SALES_PERSON"];
const ACCOUNTING_OPERATION_ROLES = ["ACCOUNTING_STAFF", "FOLLOWUP_MANAGER"];

function hasAnyRole(roles: unknown, allowed: string[]) {
  return Array.isArray(roles) && roles.some((role) => typeof role === "string" && allowed.includes(role));
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
    const role = payload.role as string | undefined;
    const roles = payload.roles;
    const shopId = payload.shopId as string | undefined;
    const userId = payload.id as string | undefined;
    logMiddleware("info", "middleware_session_decode_success", { traceId, path: pathname, userId, role, roles: Array.isArray(roles) ? roles : [], shopId });

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

    if (role === "FIELD_SALES" && pathname === "/") {
      logMiddleware("info", "middleware_redirect_field_sales_home", { traceId, path: pathname, userId, role, shopId });
      return secure(NextResponse.redirect(new URL(FIELD_SALES_HOME, request.url)));
    }
    const fieldSalesAllowedByMultiRole =
      (pathname.startsWith("/today-follow-ups") || pathname.startsWith("/follow-ups") || pathname.startsWith("/reports") || pathname.startsWith("/upload")) && hasAnyRole(roles, ACCOUNTING_OPERATION_ROLES);
    const fieldSalesApiAllowedByMultiRole =
      (pathname.startsWith("/api/follow-ups") || pathname.startsWith("/api/follow-up-reports") || pathname.startsWith("/api/reports") || pathname.startsWith("/api/today-follow-ups") || pathname.startsWith("/api/dashboard/stats")) && hasAnyRole(roles, ACCOUNTING_OPERATION_ROLES);

    if (role === "FIELD_SALES" && FIELD_SALES_BLOCKED_PAGES.some((prefix) => pathname.startsWith(prefix)) && !fieldSalesAllowedByMultiRole) {
      logMiddleware("warn", "middleware_redirect_field_sales_page_forbidden", { traceId, path: pathname, userId, role, shopId });
      return secure(NextResponse.redirect(new URL(FIELD_SALES_HOME, request.url)));
    }
    if (role === "FIELD_SALES" && FIELD_SALES_BLOCKED_APIS.some((prefix) => pathname.startsWith(prefix)) && !fieldSalesApiAllowedByMultiRole) {
      logMiddleware("warn", "middleware_reject_field_sales_api_forbidden", { traceId, path: pathname, userId, role, shopId });
      return secure(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    }

    const staffAllowedByMultiRole =
      (pathname.startsWith("/field-staff") || pathname.startsWith("/daily-visits")) && hasAnyRole(roles, FIELD_OPERATION_ROLES)
      || pathname.startsWith("/orders") && hasAnyRole(roles, ORDER_OPERATION_ROLES);
    const staffApiAllowedByMultiRole =
      pathname.startsWith("/api/field-staff") && hasAnyRole(roles, FIELD_OPERATION_ROLES)
      || pathname.startsWith("/api/orders") && hasAnyRole(roles, ORDER_OPERATION_ROLES);

    if (role === "STAFF" && STAFF_BLOCKED_PAGES.some((prefix) => pathname.startsWith(prefix)) && !staffAllowedByMultiRole) {
      logMiddleware("info", "middleware_redirect_staff_page_forbidden", { traceId, path: pathname, userId, role, shopId });
      return secure(NextResponse.redirect(new URL("/today-follow-ups", request.url)));
    }
    if (role === "STAFF" && STAFF_BLOCKED_APIS.some((prefix) => pathname.startsWith(prefix)) && !staffApiAllowedByMultiRole) {
      logMiddleware("warn", "middleware_reject_staff_api_forbidden", { traceId, path: pathname, userId, role, shopId });
      return secure(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
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
