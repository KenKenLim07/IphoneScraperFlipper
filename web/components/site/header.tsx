"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn, LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SiteHeader({ authed }: { authed: boolean }) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointerDown(e: MouseEvent) {
      const el = panelRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

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

        <div className="flex items-center gap-2" ref={panelRef}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Sun className={cn("h-4 w-4", theme === "dark" ? "hidden" : "block")} />
            <Moon className={cn("h-4 w-4", theme === "dark" ? "block" : "hidden")} />
          </Button>

          {authed ? (
            <Button asChild variant="secondary">
              <a href="/logout">
                <LogOut className="h-4 w-4" />
                Logout
              </a>
            </Button>
          ) : (
            <div className="relative">
              <Button
                variant="secondary"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls="get-access-panel"
              >
                <LogIn className="h-4 w-4" />
                Get access
              </Button>

              {open ? (
                <div
                  id="get-access-panel"
                  role="dialog"
                  aria-label="Get access"
                  className="absolute right-0 top-12 w-[min(92vw,360px)] rounded-xl border border-border bg-card p-4 text-sm text-card-foreground shadow-lg"
                >
                  <div className="font-medium">Get access</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    To view item details and open the Marketplace link, request the shared password:
                  </p>

                  <div className="mt-3 space-y-2">
                    <a
                      className="block rounded-md border border-border bg-background px-3 py-3 text-xs hover:bg-muted"
                      href="https://web.facebook.com/josemarie.lim"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Message Jose Marie Lim on Facebook
                    </a>

                    <a
                      className="block rounded-md border border-border bg-background px-3 py-3 text-xs hover:bg-muted"
                      href="mailto:josemarielim7@gmail.com"
                    >
                      Email: josemarielim7@gmail.com
                    </a>

                    <a
                      className="block rounded-md border border-border bg-background px-3 py-3 text-xs hover:bg-muted"
                      href="tel:+639544829359"
                    >
                      Mobile: 09544829359
                    </a>

                    <Link
                      className="block rounded-md border border-border bg-background px-3 py-3 text-xs hover:bg-muted"
                      href={`/login?next=${encodeURIComponent(pathname || "/")}`}
                      onClick={() => setOpen(false)}
                    >
                      Already have the password? Open login
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
