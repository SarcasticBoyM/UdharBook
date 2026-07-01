import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use this app folder as workspace root (not C:\Users\Admin where a stray lockfile exists).
  outputFileTracingRoot: path.join(__dirname),
  // ExcelJS uses Node APIs; don't bundle into the server chunk (prevents import route crashes).
  serverExternalPackages: ["exceljs"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
    // Next.js 15.x: required when middleware is used (this app has src/middleware.ts).
    middlewareClientMaxBodySize: "10mb",
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
