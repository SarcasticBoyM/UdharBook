import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { databaseUrlInfo } from "@/lib/database-url";

const TEST_SECRET = new TextEncoder().encode("udharbook-auth-health-check-secret");

export function safeAuthRuntimeDiagnostics(request?: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  let appUrlHost: string | null = null;
  let appUrlProtocol: string | null = null;
  try {
    const parsed = new URL(appUrl);
    appUrlHost = parsed.host;
    appUrlProtocol = parsed.protocol;
  } catch {
    appUrlHost = appUrl ? "invalid-url" : null;
    appUrlProtocol = null;
  }

  return {
    nodeEnv: process.env.NODE_ENV ?? null,
    runtime: process.env.NEXT_RUNTIME ?? "nodejs",
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercelGitCommitShaPresent: Boolean(process.env.VERCEL_GIT_COMMIT_SHA),
    appUrlConfigured: Boolean(process.env.APP_URL),
    nextPublicAppUrlConfigured: Boolean(process.env.NEXT_PUBLIC_APP_URL),
    nextAuthUrlConfigured: Boolean(process.env.NEXTAUTH_URL),
    appUrlHost,
    appUrlProtocol,
    requestHost: request?.headers.get("host") ?? null,
    requestProto: request?.headers.get("x-forwarded-proto") ?? null,
    sessionSecretPresent: Boolean(process.env.SESSION_SECRET),
    sessionSecretLengthOk: Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 24),
    jwtSecretPresent: Boolean(process.env.JWT_SECRET),
    nextAuthSecretPresent: Boolean(process.env.NEXTAUTH_SECRET),
    authDebugTokenConfigured: Boolean(process.env.AUTH_DEBUG_TOKEN),
    cookieName: "udharbook_session",
    cookieSecure: process.env.NODE_ENV === "production",
    cookieSameSite: "lax",
    cookiePath: "/",
    databaseUrl: databaseUrlInfo(),
  };
}

export function passwordHashDiagnostics(hash: string | null | undefined) {
  const value = hash ?? "";
  return {
    present: Boolean(value),
    length: value.length,
    looksBcrypt: /^\$2[aby]\$\d{2}\$/.test(value),
  };
}

export async function bcryptSelfTest() {
  const hash = await bcrypt.hash("udharbook-auth-self-test", 4);
  return bcrypt.compare("udharbook-auth-self-test", hash);
}

export async function jwtSelfTest() {
  const token = await new SignJWT({ probe: "auth-health" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("60s")
    .sign(TEST_SECRET);
  const { payload } = await jwtVerify(token, TEST_SECRET);
  return payload.probe === "auth-health";
}

