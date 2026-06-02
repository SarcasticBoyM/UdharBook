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
};

export default nextConfig;
