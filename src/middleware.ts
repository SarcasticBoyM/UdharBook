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
  "/manifest.webmanifest",
  "/sw.js",
  "/icon.svg",
];

function getSecret() {
  const secret =
    process.env.SESSION_SECRET ?? "dev-secret-change-in-production-min-32-chars";
  return new TextEncoder().encode(secret);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
    if (pathname.startsWith("/api/")) {
      return secure(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }
    return secure(NextResponse.redirect(new URL("/login", request.url)));
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());
    const role = payload.role as string | undefined;
    const shopId = payload.shopId as string | undefined;

    if (pathname.startsWith("/shops") && role !== "SUPER_ADMIN") {
      return secure(NextResponse.redirect(new URL("/", request.url)));
    }
    if (pathname.startsWith("/api/shops") && role !== "SUPER_ADMIN") {
      return secure(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    }
    if (pathname.startsWith("/api/onboarding") && role !== "SUPER_ADMIN") {
      return secure(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    }
    if ((pathname.startsWith("/follow-ups") || pathname.startsWith("/reports")) && role === "STAFF") {
      return secure(NextResponse.redirect(new URL("/today-follow-ups", request.url)));
    }
    if (pathname.startsWith("/live-tracking") && role === "STAFF") {
      return secure(NextResponse.redirect(new URL("/field-staff", request.url)));
    }
    if (
      (pathname.startsWith("/api/follow-up-reports") || pathname.startsWith("/api/reports")) &&
      role === "STAFF"
    ) {
      return secure(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    }
    if (!shopId) {
      return secure(NextResponse.redirect(new URL("/login", request.url)));
    }

    return secure(NextResponse.next());
  } catch {
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
