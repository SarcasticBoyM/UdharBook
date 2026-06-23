import { randomBytes } from "crypto";

export function generateOrderPublicToken() {
  return randomBytes(32).toString("base64url");
}

export function publicOrderUrl(request: Request, token: string) {
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  return `${origin.replace(/\/$/, "")}/vcard/order/${token}`;
}
