import Link from "next/link";
import { BadgePercent, CheckCircle2, Clock, Flag, Radar, ShieldCheck } from "lucide-react";

import { ListingSignalPills } from "@/components/listing-signal-pills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const previewRiskFlags = {
  face_id_working: true,
  trutone_working: true,
  lcd_replaced: true,
  network_locked: false,
  no_description: false
};

const stats = [
  { label: "Updated every few minutes", value: "Fresh data", helper: "so you see the latest deals" },
  { label: "Highlights underpriced listings", value: "Value first", helper: "so you can act fast" },
  { label: "Flags risky devices", value: "Red flags", helper: "so you avoid bad units" },
  { label: "Shows what’s worth messaging", value: "Faster decisions", helper: "no guesswork" }
];

const steps = [
  {
    title: "We scan new listings",
    description: "Fresh posts show up quickly so you can move first.",
    icon: Radar
  },
  {
    title: "We check price and condition",
    description: "We compare similar listings to estimate real value.",
    icon: ShieldCheck
  },
  {
    title: "We show if it’s a good deal",
    description: "We highlight issues like Face ID, screen, and locks.",
    icon: BadgePercent
  }
];

const benefits = [
  {
    title: "Spot problems before you buy",
    description: "See red flags early so you avoid costly mistakes."
  },
  {
    title: "Compare prices instantly",
    description: "We estimate real value so you don’t overpay."
  },
  {
    title: "Find underpriced phones faster",
    description: "Move quickly when a good deal appears."
  },
  {
    title: "See only fresh listings",
    description: "Stay ahead with listings checked regularly."
  }
];

export default function Home() {
  return (
    <div className="space-y-12 sm:space-y-16">
      <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="space-y-5">
          <Badge variant="outline" className="w-fit border-border/70 bg-card/60 text-xs">
            Ops Center Noir · Deal Intelligence
          </Badge>
              <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
  Spot underpriced iPhones before others do.
</h1>

<p className="mt-2 text-lg font-semibold text-foreground sm:text-xl">
  Stop overpaying or buying bad units.
</p>

<p className="mt-4 text-base text-muted-foreground sm:text-lg">
  We compare prices and flag hidden issues so you don’t overpay or buy a bad unit.
</p>

<p className="mt-2 text-sm text-foreground/70">
  Skip the noise — find listings that are actually worth your time.
</p>

<p className="mt-1 text-sm text-foreground/60">
  Good deals don’t stay long.
</p>

<div className="mt-4 flex flex-wrap gap-2">
            <Button asChild className="min-w-[160px]">
              <Link href="/listings">View listings</Link>
            </Button>
            <Button asChild variant="secondary" className="min-w-[120px]">
              <Link href="/login">Login</Link>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              We compare similar listings to estimate real value
            </span>
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              We highlight issues like Face ID, screen, and locks
            </span>
          </div>
        </div>

        <Card className="relative overflow-hidden border-border/70 bg-card/80 shadow-[0_0_30px_rgba(37,99,235,0.12)]">
          <CardHeader className="space-y-1">
            <CardTitle className="text-lg">Live Preview</CardTitle>
            <CardDescription>See if it’s worth messaging.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">iPhone 12 Pro 128GB</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Bacolod City, PH-06 · active</span>
                  <Badge
                    variant="outline"
                      className="border-border bg-muted/40 text-[11px] text-muted-foreground">
                         Just posted
                      </Badge>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge variant="secondary" className="bg-emerald-600 text-white">
                  Good Deal?
                </Badge>
                <span className="text-xs text-muted-foreground">Confidence: Medium</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg border border-border bg-muted/30 p-2">
                <div className="text-muted-foreground">Below average price</div>
                <div className="font-mono text-sm">22%</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-2">
                <div className="text-muted-foreground">Estimated profit</div>
                <div className="font-mono text-sm">₱1,500</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-2">
                <div className="text-muted-foreground">Good Deal?</div>
                <div className="font-mono text-sm">Yes</div>
              </div>
            </div>
            <ListingSignalPills
              variant="detail"
              maxWarnings={2}
              riskFlags={previewRiskFlags}
              batteryHealth={87}
              openline={true}
            />
            <div className="rounded-lg border border-rose-500/60 bg-rose-500/5 p-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2 font-medium text-rose-300">
                <Flag className="h-4 w-4" />
                Red Flags
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>LCD replaced</li>
                <li>Screen issue likely</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="border-border/70 bg-card/70">
            <CardContent className="flex min-h-[120px] flex-col justify-center gap-2 p-4">
              <div className="text-xs text-muted-foreground">{stat.label}</div>
              <div className="text-lg font-semibold text-foreground">
                <span className="font-mono" style={{ textShadow: "0 0 12px rgba(37,99,235,0.35)" }}>
                  {stat.value}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">{stat.helper}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">How it works</h2>
          <p className="text-sm text-muted-foreground">A tight pipeline that prioritizes speed and trust.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {steps.map((step) => (
            <Card key={step.title} className="h-full border-border/70 bg-card/70">
              <CardContent className="flex min-h-[140px] flex-col justify-center gap-3 p-4">
                <step.icon className="h-5 w-5 text-primary" aria-hidden />
                <div className="text-sm font-semibold">{step.title}</div>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">So you know what’s worth messaging.</p>
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Why it helps</h2>
          <p className="text-sm text-muted-foreground">Everything you need to flip safely and fast.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {benefits.map((benefit) => (
            <Card key={benefit.title} className="border-border/70 bg-card/70">
              <CardContent className="flex min-h-[140px] flex-col justify-center gap-3 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <BadgePercent className="h-4 w-4 text-primary" aria-hidden />
                  {benefit.title}
                </div>
                <p className="text-xs text-muted-foreground">{benefit.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>Built on real marketplace data</CardTitle>
            <CardDescription>Decision support you can trust.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Radar className="h-4 w-4 text-primary" aria-hidden />
              Based on real marketplace data.
            </div>
            <div className="flex items-center gap-2">
              <BadgePercent className="h-4 w-4 text-primary" aria-hidden />
              Analyzes price, condition, and listing details.
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" aria-hidden />
              Listings are checked regularly.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>Ready to scout deals?</CardTitle>
            <CardDescription>Jump into the listings and start triaging fast.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button asChild className="w-full">
              <Link href="/listings">View listings</Link>
            </Button>
            <Button asChild variant="secondary" className="w-full">
              <Link href="/login">Login</Link>
            </Button>
            <p className="text-xs text-muted-foreground">See what’s worth messaging — before it’s gone.</p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
