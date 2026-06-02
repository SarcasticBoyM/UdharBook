import crypto from "crypto";

export function generateTemporaryPassword() {
  return `UB-${crypto.randomBytes(5).toString("hex")}-${crypto.randomInt(100, 999)}`;
}

