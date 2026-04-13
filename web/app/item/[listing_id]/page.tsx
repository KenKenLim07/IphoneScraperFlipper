import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink, XCircle } from "lucide-react";

import { BatteryHealthPill, PublicListingChecklist } from "@/components/listing-signal-pills";
import { PriceHistoryChart } from "@/components/price-history-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchPrivateListing } from "@/lib/data";
import { formatDateTime, formatPct, formatPhp, formatRelativeAge, stripEmojiFromTitle } from "@/lib/format";
import { parseRiskFlags, triStateFromFlags } from "@/lib/riskFlags";

function statusBadge(status: string) {
  const s = String(status || "active").toLowerCase();
  if (s === "sold") return <Badge className="bg-amber-500 text-white">sold</Badge>;
  if (s === "unavailable") return <Badge className="bg-slate-600 text-white">unavailable</Badge>;
  return <Badge variant="secondary">active</Badge>;
}

function dealScoreBadge(score: unknown) {
  const s = String(score || "").toUpperCase();
  if (s === "A") return <Badge className="bg-emerald-600 text-white">A</Badge>;
  if (s === "B") return <Badge className="bg-sky-600 text-white">B</Badge>;
  if (s === "C") return <Badge className="bg-amber-500 text-white">C</Badge>;
  if (s === "D") return <Badge variant="secondary">D</Badge>;
  return <span className="text-muted-foreground">—</span>;
}

function confidenceBadge(value: unknown) {
  const v = String(value || "").toLowerCase();
  if (v === "high") return <Badge className="bg-emerald-600 text-white">high</Badge>;
  if (v === "med") return <Badge className="bg-sky-600 text-white">med</Badge>;
  if (v === "low") return <Badge variant="secondary">low</Badge>;
  return <span className="text-muted-foreground">—</span>;
}

function buildWarnings(listing: any): string[] {
  const flags = parseRiskFlags(listing?.risk_flags);
  const warnings: string[] = [];

  if (flags.icloud_lock) warnings.push("iCloud / reset risk");
  if (flags.wanted_post) warnings.push("Wanted / buying post");
  if (flags.price_too_low) warnings.push("Tikalon price check");
  if (flags.audio_issue) warnings.push("Mic / speaker issue");
  if (flags.face_id_not_working) warnings.push("Face ID not working");
  if (flags.screen_issue) warnings.push("Screen problem");
  if (flags.camera_issue) warnings.push("Camera problem");
  if (flags.lcd_replaced) warnings.push("Screen replaced");
  if (flags.network_locked) warnings.push("Network lock");
  if (flags.wifi_only) warnings.push("Wi‑Fi only");
  if (flags.trutone_missing) warnings.push("TrueTone missing");
  if (flags.back_glass_replaced) warnings.push("Back glass replaced");
  if (flags.back_glass_cracked) warnings.push("Back glass cracked");
  if (flags.battery_replaced) warnings.push("Battery replaced");
  if (flags.button_issue) warnings.push("Button issue");
  if (flags.no_description) warnings.push("Unknown condition");

  return warnings;
}

export default async function ItemPage({ params }: { params: Promise<{ listing_id: string }> }) {
  const { listing_id } = await params;
  const res = await fetchPrivateListing(String(listing_id));
  if (!res) notFound();

  const { listing, versions } = res;
  const warnings = buildWarnings(listing);

  const score = String(listing.deal_score || "").toUpperCase();
  const confidence = String(listing.confidence || "").toLowerCase();
  const profit = typeof listing.est_profit_php === "number" ? listing.est_profit_php : null;

  const flags = parseRiskFlags(listing.risk_flags);
  const hardBlocked = flags.icloud_lock || flags.wanted_post || score === "NA";
  const faceIdTri = triStateFromFlags(flags, "face_id_working", "face_id_not_working");
  const trutoneTri = triStateFromFlags(flags, "trutone_working", "trutone_missing");

  const goodForFlipping =
    !hardBlocked &&
    (score === "A" || score === "B" || score === "C") &&
    profit != null &&
    Number.isFinite(profit) &&
    profit > 0 &&
    confidence !== "low";

  const verdictTitle = goodForFlipping
    ? "Good deal"
    : hardBlocked
      ? "High risk — not recommended"
      : profit != null && profit <= 0
        ? "Not profitable based on comps"
        : confidence === "low"
          ? "Low confidence — needs a quick check"
          : "Needs a quick manual check";

  const verdictReason = hardBlocked
    ? "Major risk flags were detected."
    : profit != null && profit <= 0
      ? "Estimated profit is not positive."
      : confidence === "low"
        ? "Not enough similar listings for strong confidence."
        : "Worth a closer look before deciding.";

  const compsLabel =
    listing.comp_sample_size != null
      ? `Based on ${listing.comp_sample_size} similar listings`
      : "Not enough similar listings yet";

  const belowMarketCopy =
    listing.below_market_pct != null
      ? `Priced ${formatPct(listing.below_market_pct)} below similar listings`
      : "Pricing vs similar listings: —";

  return (
    <div className="space-y-5 sm:space-y-7">
      <header className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="font-mono text-xs text-muted-foreground">listing_id={listing.listing_id}</div>
            <div className="flex flex-wrap items-baseline gap-3">
              <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
                {stripEmojiFromTitle(listing.title)}
              </h1>
              <span className="font-mono text-xl text-foreground sm:text-2xl">
                {formatPhp(listing.price_php)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{listing.location_raw || "—"}</span>
              <span>•</span>
              {statusBadge(listing.status)}
              <span>•</span>
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground">score</span>
                {dealScoreBadge(listing.deal_score)}
              </span>
              <span>•</span>
              <span title={formatDateTime(listing.posted_at || listing.first_seen_at)}>
                listed {formatRelativeAge(listing.posted_at || listing.first_seen_at)}
                {!listing.posted_at ? " (est.)" : ""}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <Button asChild className="w-full sm:w-auto">
              <a href={listing.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                <span className="flex flex-col items-start leading-tight">
                  <span>Message seller</span>
                  <span className="text-[11px] text-primary-foreground/80">Open on Facebook</span>
                </span>
              </a>
            </Button>
            <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
              <Link href="/listings">Back to list</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <section className="rounded-xl border border-border/70 bg-card/50 p-4 sm:p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Summary</div>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 text-base font-semibold">
                {goodForFlipping ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden />
                ) : hardBlocked ? (
                  <XCircle className="h-5 w-5 text-rose-500" aria-hidden />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />
                )}
                <span>{verdictTitle}</span>
              </div>
              <p className="text-sm text-muted-foreground">{verdictReason}</p>
              <p className="text-xs text-muted-foreground">{compsLabel}</p>
            </div>
            <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Deal score</span>
                <span className="flex items-center gap-2">{dealScoreBadge(listing.deal_score)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Confidence</span>
                {confidenceBadge(listing.confidence)}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Pricing</span>
                <span className="font-mono text-xs">{belowMarketCopy}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Est. profit</span>
                <span className="font-mono">{formatPhp(listing.est_profit_php ?? null)}</span>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border/70 bg-card/40 p-4 sm:p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Seller description</div>
            <div className="mt-3 text-sm leading-relaxed text-foreground">
              {listing.description ? (
                <p className="whitespace-pre-wrap">{listing.description}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No description captured yet.</p>
              )}
            </div>
          </section>

          <details className="rounded-xl border border-border/70 bg-card/30 p-4 sm:p-5">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">
              Advanced details (market data + history)
            </summary>
            <div className="mt-4 space-y-4">
              <section className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Market comps</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Sample size</span>
                    <span className="font-mono">{listing.comp_sample_size ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">p25 / p50 / p75</span>
                    <span className="font-mono">
                      {listing.comp_p25 != null ? formatPhp(listing.comp_p25) : "—"} /{" "}
                      {listing.comp_p50 != null ? formatPhp(listing.comp_p50) : "—"} /{" "}
                      {listing.comp_p75 != null ? formatPhp(listing.comp_p75) : "—"}
                    </span>
                  </div>
                </div>
                {Array.isArray(listing.reasons) && listing.reasons.length ? (
                  <div className="mt-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Why</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                      {listing.reasons.slice(0, 8).map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>

              <section className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Price history</div>
                <div className="mt-3">
                  <PriceHistoryChart versions={versions} />
                </div>
              </section>

              <section className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recent versions</div>
                <div className="mt-3 space-y-2 sm:hidden">
                  {versions.slice(0, 20).map((v) => (
                    <div key={v.snapshot_at} className="rounded-xl border border-border bg-background p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-xs text-muted-foreground">
                            {formatDateTime(v.snapshot_at)}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-mono">{formatPhp(v.price_php)}</span>
                            {v.status ? statusBadge(v.status) : <span className="text-xs text-muted-foreground">—</span>}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Changed:</span>{" "}
                        {Array.isArray(v.changed_fields) && v.changed_fields.length
                          ? v.changed_fields.map((x) => String(x)).join(", ")
                          : "—"}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden overflow-x-auto sm:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">Snapshot</TableHead>
                        <TableHead className="whitespace-nowrap">Price</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Changed fields</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {versions.slice(0, 25).map((v) => (
                        <TableRow key={v.snapshot_at} className="transition-colors hover:bg-muted/40">
                          <TableCell className="whitespace-nowrap font-mono">{formatDateTime(v.snapshot_at)}</TableCell>
                          <TableCell className="whitespace-nowrap font-mono">{formatPhp(v.price_php)}</TableCell>
                          <TableCell>
                            {v.status ? statusBadge(v.status) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {Array.isArray(v.changed_fields) && v.changed_fields.length
                              ? v.changed_fields.map((x) => String(x)).join(", ")
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Specs</div>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Model</span>
                    <span className="font-mono">{[listing.model_family, listing.variant].filter(Boolean).join(" ") || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Storage</span>
                    <span className="font-mono">{listing.storage_gb != null ? `${listing.storage_gb}GB` : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Battery health</span>
                    <span className="font-mono">{listing.battery_health != null ? `${listing.battery_health}%` : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Face ID</span>
                    <span className="font-mono">{faceIdTri}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">TrueTone</span>
                    <span className="font-mono">{trutoneTri}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">LCD</span>
                    <span className="font-mono">{flags.lcd_replaced ? "replaced" : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Network</span>
                    <span className="font-mono">{flags.network_locked ? "locked" : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Openline</span>
                    <span className="font-mono">
                      {typeof listing.openline === "boolean" ? (listing.openline ? "yes" : "no") : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Condition</span>
                    <span className="font-mono">{listing.condition_raw || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Region</span>
                    <span className="font-mono">{listing.region_code || "—"}</span>
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Metadata</div>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Posted</span>
                    <span className="font-mono" title={formatDateTime(listing.posted_at || listing.first_seen_at)}>
                      {formatRelativeAge(listing.posted_at || listing.first_seen_at)}
                      {!listing.posted_at ? " (est.)" : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">First seen</span>
                    <span className="font-mono">{formatDateTime(listing.first_seen_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Last seen</span>
                    <span className="font-mono">{formatDateTime(listing.last_seen_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Price change</span>
                    <span className="font-mono">{formatDateTime(listing.last_price_change_at)}</span>
                  </div>
                </div>
              </section>
            </div>
          </details>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <section className="rounded-xl border border-border/70 bg-card/60 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Quick checks</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PublicListingChecklist riskFlags={listing.risk_flags} openline={listing.openline} />
              <BatteryHealthPill batteryHealth={listing.battery_health} />
            </div>
          </section>

          {warnings.length ? (
            <section className="rounded-xl border border-rose-200/70 bg-rose-50/70 p-4 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                <span>Red flags</span>
              </div>
              <p className="mt-2 text-xs text-rose-700/80 dark:text-rose-200/80">
                {flags.no_description
                  ? "Seller did not provide enough details. Ask for Face ID, TrueTone, Openline, and battery health."
                  : "These usually mean extra repair cost or risk."}
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
                {warnings.slice(0, 10).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="rounded-xl border border-border/70 bg-muted/30 p-4 text-foreground">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                <span>No red flags mentioned</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Based only on the description. Confirm details with the seller.
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
