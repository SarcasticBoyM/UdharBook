import type { Metadata } from "next";
import type { Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { PwaInstallPrompt } from "@/components/PwaInstallPrompt";
import { PwaRegister } from "@/components/PwaRegister";

export const metadata: Metadata = {
  title: {
    default: "UdharBook | Business Credit Follow-ups",
    template: "%s | UdharBook",
  },
  description: "Track customer balances, follow-ups, reminders, and recoveries with UdharBook.",
  applicationName: "UdharBook",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "UdharBook",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          <PwaRegister />
          <PwaInstallPrompt />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
