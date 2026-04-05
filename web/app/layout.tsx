import type { Metadata } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";

import "@/app/globals.css";
import { SiteHeader } from "@/components/site/header";
import { ThemeProvider } from "@/components/theme-provider";
import { isAuthedCookieStore } from "@/lib/auth";

const fontSans = Fira_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["300", "400", "500", "600", "700"]
});

const fontMono = Fira_Code({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600", "700"]
});

export const metadata: Metadata = {
  title: "IAASE Dashboard",
  description: "Public iPhone Marketplace listings dashboard (details gated)."
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const authed = await isAuthedCookieStore();
  return (
    <html lang="en" className={`${fontSans.variable} ${fontMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh">
        <ThemeProvider>
          <SiteHeader authed={authed} />
          <main className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6 lg:px-6">{children}</main>
          <footer className="mx-auto max-w-6xl px-3 pb-10 pt-6 text-xs text-muted-foreground sm:px-4 lg:px-6">
            Data updates automatically. Details and seller link require login.
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
