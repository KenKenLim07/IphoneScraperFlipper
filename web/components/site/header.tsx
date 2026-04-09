"use client";

import Link from "next/link";
import { LogIn, LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SiteHeader({ authed }: { authed: boolean }) {
  const { theme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/70 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-2.5 sm:gap-4 sm:px-4 sm:py-3 lg:px-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="group inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_18px_rgba(37,99,235,0.55)]" />
            <span className="text-sm font-semibold tracking-tight">IAASE</span>
            <span className="text-xs text-muted-foreground">Marketplace watch</span>
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Sun className={cn("h-4 w-4", theme === "dark" ? "hidden" : "block")} />
            <Moon className={cn("h-4 w-4", theme === "dark" ? "block" : "hidden")} />
          </Button>

          <Button asChild>
            <Link href="/listings">View listings</Link>
          </Button>

          {authed ? (
            <Button asChild variant="secondary">
              <a href="/logout">
                <LogOut className="h-4 w-4" />
                Logout
              </a>
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link href="/login">
                <LogIn className="h-4 w-4" />
                Login
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
