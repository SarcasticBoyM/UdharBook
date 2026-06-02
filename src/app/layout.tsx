import type { Metadata } from "next";
import type { Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { PwaRegister } from "@/components/PwaRegister";

export const metadata: Metadata = {
  title: {
    default: "UdharBook | Business Credit Follow-ups",
    template: "%s | UdharBook",
  },
  description: "Track customer balances, follow-ups, reminders, and recoveries with UdharBook.",
  applicationName: "UdharBook",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "UdharBook",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          <PwaRegister />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
