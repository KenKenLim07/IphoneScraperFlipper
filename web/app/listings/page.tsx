import Link from "next/link";

import { ListingSignalPills } from "@/components/listing-signal-pills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchPublicListings } from "@/lib/data";
import { formatDateTime, formatPct, formatPhp, formatRelativeAge } from "@/lib/format";
import { parseRiskFlags } from "@/lib/riskFlags";
import type { PublicListing } from "@/lib/types";
import { Flag } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function asString(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] || "" : v || "";
}

function statusBadge(status: string) {
  const s = String(status || "active").toLowerCase();
  if (s === "sold") return <Badge className="bg-amber-500 text-white">sold</Badge>;
  if (s === "unavailable") return <Badge className="bg-slate-600 text-white">unavailable</Badge>;
  return <Badge variant="secondary">active</Badge>;
}

function scoreTone(score: unknown) {
  const s = String(score || "").toUpperCase();
  if (s === "A") return { bg: "bg-emerald-600", text: "text-emerald-300" };
  if (s === "B") return { bg: "bg-amber-500", text: "text-amber-300" };
  if (s === "C") return { bg: "bg-rose-600", text: "text-rose-300" };
  return { bg: "bg-muted", text: "text-muted-foreground" };
}

function dealScoreBadge(score: unknown) {
  const s = String(score || "").toUpperCase();
  if (s !== "A" && s !== "B" && s !== "C") return null;
  const tone = scoreTone(s);
  return (
    <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white ${tone.bg}`}>
      {s}
    </span>
  );
}

function confidenceLabel(value: unknown) {
  const v = String(value || "").toLowerCase();
  if (v === "high" || v === "med" || v === "low") return v;
  return "—";
}

function confidenceTone(value: unknown) {
  const v = String(value || "").toLowerCase();
  if (v === "high") return "text-emerald-300";
  if (v === "med") return "text-amber-300";
  if (v === "low") return "text-rose-300";
  return "text-muted-foreground";
}

function buildRedFlags(value: unknown): string[] {
  const flags = parseRiskFlags(value);
  const warnings: string[] = [];

  if (flags.icloud_lock) warnings.push("iCloud / activation / reset risk");
  if (flags.wanted_post) warnings.push("Looks like buyer/wanted post (LF/WTB/BUYING)");
  if (flags.face_id_not_working) warnings.push("Face ID not working");
  if (flags.screen_issue) warnings.push("Screen issue detected");
  if (flags.camera_issue) warnings.push("Camera issue detected");
  if (flags.lcd_replaced) warnings.push("LCD replaced");
  if (flags.network_locked) warnings.push("Network-locked (Globe/Smart/SIM lock)");
  if (flags.wifi_only) warnings.push("WiFi-only (no cellular)");
  if (flags.trutone_missing) warnings.push("TrueTone missing");
  if (flags.back_glass_replaced) warnings.push("Back glass replaced");
  if (flags.back_glass_cracked) warnings.push("Back glass cracked");
  if (flags.battery_replaced) warnings.push("Battery replaced");
  if (flags.no_description) warnings.push("No/short description (unknown condition)");

  return warnings;
}

function showDeal(row: PublicListing) {
  const s = String(row.deal_score || "").toUpperCase();
  return s === "A" || s === "B" || s === "C";
}

function buildHref(params: Record<string, string>, overrides: Partial<Record<string, string>>) {
  const merged = { ...params, ...overrides };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (!v) continue;
    sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `/listings?${qs}` : "/listings";
}

export default async function Home({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const params = {
    query: asString(sp.query),
    status: asString(sp.status),
    sort: asString(sp.sort) || "deals",
    page: asString(sp.page) || "1"
  };

  const page = Math.max(1, Number.parseInt(params.page || "1", 10) || 1);
  const sortMode = params.sort === "latest" ? "latest" : "deals";

  const data = await fetchPublicListings({
    query: params.query || null,
    status: params.status || null,
    sort: sortMode,
    page,
    pageSize: 50
  });

  const nowMs = Date.now();
  const totalListings =
    typeof data.total === "number" && Number.isFinite(data.total) ? data.total : null;
  const updatedAt =
    data.items
      .map((i) => i.last_seen_at)
      .filter(Boolean)
      .map((v) => new Date(String(v)).getTime())
      .filter((ms) => Number.isFinite(ms))
      .sort((a, b) => b - a)[0] || null;
  const hasDeals = data.items.some((row) => showDeal(row));
  const showDealColumn = sortMode === "deals" || hasDeals;
  const sortLabel = sortMode === "deals" ? "profit" : "latest";

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-balance text-xl font-semibold tracking-tight sm:text-2xl">Public listings</h1>
        <p className="text-xs text-muted-foreground">
          Updated at {updatedAt ? formatDateTime(new Date(updatedAt).toISOString()) : "—"}
        </p>
        <p className="text-sm text-muted-foreground">
          Browse recent iPhone listings. Deal score is public; detail page and seller link are gated behind login.
        </p>
      </div>

      <form method="get" className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_120px_auto] sm:items-end">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground sm:text-xs" htmlFor="query">
              Search
            </label>
            <Input id="query" name="query" placeholder="e.g. iPhone 13 128" defaultValue={params.query} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground sm:text-xs" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={params.status}
              className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-10"
            >
              <option value="">Any</option>
              <option value="active">active</option>
              <option value="sold">sold</option>
              <option value="unavailable">unavailable</option>
            </select>
          </div>
          <div>
            <Button type="submit" className="w-full">
              Search
            </Button>
          </div>
          <div className="hidden items-end justify-end sm:flex">
            <div className="inline-flex rounded-md border border-border bg-background/60 p-1">
              <Button
                asChild
                size="sm"
                variant={sortMode === "deals" ? "secondary" : "ghost"}
                className="h-9 px-3 text-xs"
              >
                <Link href={buildHref(params, { sort: "deals", page: "1" })} aria-current={sortMode === "deals" ? "page" : undefined}>
                  Best deals
                </Link>
              </Button>
              <Button
                asChild
                size="sm"
                variant={sortMode === "latest" ? "secondary" : "ghost"}
                className="h-9 px-3 text-xs"
              >
                <Link href={buildHref(params, { sort: "latest", page: "1" })} aria-current={sortMode === "latest" ? "page" : undefined}>
                  Latest
                </Link>
              </Button>
            </div>
          </div>
        </div>

        <div className="flex sm:hidden">
          <div className="inline-flex w-full rounded-md border border-border bg-background/60 p-1">
            <Button
              asChild
              size="sm"
              variant={sortMode === "deals" ? "secondary" : "ghost"}
              className="h-9 flex-1 px-3 text-xs"
            >
              <Link href={buildHref(params, { sort: "deals", page: "1" })} aria-current={sortMode === "deals" ? "page" : undefined}>
                Best deals
              </Link>
            </Button>
            <Button
              asChild
              size="sm"
              variant={sortMode === "latest" ? "secondary" : "ghost"}
              className="h-9 flex-1 px-3 text-xs"
            >
              <Link href={buildHref(params, { sort: "latest", page: "1" })} aria-current={sortMode === "latest" ? "page" : undefined}>
                Latest
              </Link>
            </Button>
          </div>
        </div>

        <input type="hidden" name="page" value="1" />
        <input type="hidden" name="sort" value={sortMode} />

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Showing {data.items.length} items • page {data.page} • sorted by {sortLabel}
          </span>
          <Link className="underline underline-offset-4 hover:text-foreground" href="/listings">
            Clear filters
          </Link>
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Total listings</CardTitle>
          <CardDescription>
            Total listings: {totalListings != null ? totalListings.toLocaleString() : "—"} • Click any row to view the
            detail page (login required).
          </CardDescription>
        </CardHeader>
        <CardContent>

          {data.items.length ? (
            <>
              <div className="space-y-3 sm:hidden">
                {data.items.map((row: PublicListing) => (
                  (() => {
                    const dealVisible = showDeal(row);
                    const score = dealVisible ? dealScoreBadge(row.deal_score) : null;
                    const below = dealVisible ? row.below_market_pct : null;
                    const conf = dealVisible ? row.confidence : null;
                    const profit = dealVisible ? row.est_profit_php : null;
                    const confidenceText = confidenceLabel(conf);
                    const confidenceClass = confidenceTone(conf);
                    const redFlags = buildRedFlags(row.risk_flags);
                    const shownRedFlags = redFlags.slice(0, 6);
                    const extraRedFlags = redFlags.length - shownRedFlags.length;
                    return (
                  <Link
                    key={row.listing_id}
                    href={`/item/${encodeURIComponent(row.listing_id)}`}
                    className="block rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm transition-colors active:bg-muted/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium leading-snug">
                          <span>{row.public_title}</span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {row.location_raw || "—"}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <ListingSignalPills
                            riskFlags={row.risk_flags}
                            batteryHealth={row.battery_health}
                            openline={row.openline}
                            variant="public"
                          />
                        </div>
                        {shownRedFlags.length ? (
                          <div className="mt-2 rounded-lg border border-rose-500/60 bg-rose-500/5 p-2 text-[11px] text-muted-foreground">
                            <div className="flex items-center gap-2 font-medium text-rose-300">
                              <Flag className="h-3 w-3" aria-hidden />
                              Red Flags Detected
                            </div>
                            <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 list-disc pl-4">
                              {shownRedFlags.map((flag) => (
                                <li key={flag}>{flag}</li>
                              ))}
                              {extraRedFlags > 0 ? (
                                <li className="col-span-2 text-muted-foreground">+{extraRedFlags} more</li>
                              ) : null}
                            </ul>
                          </div>
                        ) : null}
                        {score ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            {score}
                            <span className="flex items-center gap-1 font-mono">
                              <span>{below != null ? `${formatPct(below)} below` : "—"}</span>
                              <span>•</span>
                              <span className={confidenceClass}>{confidenceText}</span>
                            </span>
                          </div>
                        ) : sortMode === "deals" ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <Badge variant="outline" className="h-6 px-2 py-0 text-[11px] text-muted-foreground">
                              Unscored
                            </Badge>
                          </div>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-sm">{formatPhp(row.price_php)}</div>
                        <div className="mt-1 flex justify-end">{statusBadge(row.status)}</div>
                        {score ? (
                          <div className="mt-2 text-[11px] text-muted-foreground">
                            possible profit{" "}
                            <span className="font-mono text-foreground">{formatPhp(profit)}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="font-mono">id={row.listing_id}</span>
                      <span className="font-mono">
                        {formatRelativeAge(row.posted_at || row.first_seen_at, nowMs)}
                        {!row.posted_at ? " (est.)" : ""}
                      </span>
                    </div>
                  </Link>
                    );
                  })()
                ))}
              </div>

              <div className="hidden overflow-x-auto sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Model</TableHead>
                      <TableHead className="whitespace-nowrap">Price</TableHead>
                      <TableHead className="whitespace-nowrap">Location</TableHead>
                      {showDealColumn ? <TableHead className="whitespace-nowrap">Deal</TableHead> : null}
                      <TableHead>Status</TableHead>
                      <TableHead className="whitespace-nowrap">Posted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((row: PublicListing) => (
                      (() => {
                        const dealVisible = showDeal(row);
                        const score = dealVisible ? dealScoreBadge(row.deal_score) : null;
                        const below = dealVisible ? row.below_market_pct : null;
                        const conf = dealVisible ? row.confidence : null;
                        const profit = dealVisible ? row.est_profit_php : null;
                        const confidenceText = confidenceLabel(conf);
                        const confidenceClass = confidenceTone(conf);
                        const redFlags = buildRedFlags(row.risk_flags);
                        const shownRedFlags = redFlags.slice(0, 6);
                        const extraRedFlags = redFlags.length - shownRedFlags.length;
                        return (
                      <TableRow key={row.listing_id}>
                        <TableCell className="min-w-[320px] max-w-[420px]">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/item/${encodeURIComponent(row.listing_id)}`}
                              className="font-medium hover:underline hover:underline-offset-4"
                            >
                              {row.public_title}
                            </Link>
                          </div>
                        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                          id={row.listing_id}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <ListingSignalPills
                            riskFlags={row.risk_flags}
                            batteryHealth={row.battery_health}
                            openline={row.openline}
                            variant="public"
                          />
                        </div>
                        {shownRedFlags.length ? (
                          <div className="mt-2 rounded-lg border border-rose-500/60 bg-rose-500/5 p-2 text-[11px] text-muted-foreground">
                            <div className="flex items-center gap-2 font-medium text-rose-300">
                              <Flag className="h-3 w-3" aria-hidden />
                              Red Flags
                            </div>
                            <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 list-disc pl-4">
                              {shownRedFlags.map((flag) => (
                                <li key={flag}>{flag}</li>
                              ))}
                              {extraRedFlags > 0 ? (
                                <li className="col-span-2 text-muted-foreground">+{extraRedFlags} more</li>
                              ) : null}
                            </ul>
                          </div>
                        ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono">{formatPhp(row.price_php)}</TableCell>
                        <TableCell className="max-w-[200px] truncate" title={row.location_raw || ""}>
                          {row.location_raw || "—"}
                        </TableCell>
                        {showDealColumn ? (
                          <TableCell className="whitespace-nowrap">
                            {dealVisible ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground">Score</span>
                                  {score || <span className="text-muted-foreground">—</span>}
                                </div>
                                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <span className="font-mono">{below != null ? `${formatPct(below)} below` : "—"}</span>
                                  <span>•</span>
                                  <span className={confidenceClass}>{confidenceText}</span>
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  possible profit{" "}
                                  <span className="font-mono text-foreground">{formatPhp(profit)}</span>
                                </div>
                              </div>
                            ) : sortMode === "deals" ? (
                              <span className="text-xs text-muted-foreground">Unscored</span>
                            ) : null}
                          </TableCell>
                        ) : null}
                        <TableCell>{statusBadge(row.status)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span title={formatDateTime(row.posted_at || row.first_seen_at)}>
                            {formatRelativeAge(row.posted_at || row.first_seen_at, nowMs)}
                          </span>
                          {!row.posted_at ? <span className="ml-2 text-[11px] text-muted-foreground">(est.)</span> : null}
                        </TableCell>
                      </TableRow>
                        );
                      })()
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <div className="text-sm font-medium">No results</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Try widening your filters (or clear them).
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            {data.page <= 1 ? (
              <Button variant="outline" className="min-w-[120px]" disabled>
                Prev
              </Button>
            ) : (
              <Button asChild variant="outline" className="min-w-[120px]">
                <Link href={buildHref(params, { page: String(Math.max(1, data.page - 1)) })}>Prev</Link>
              </Button>
            )}

            <div className="text-xs text-muted-foreground">Page {data.page}</div>

            {!data.hasMore ? (
              <Button variant="outline" className="min-w-[120px]" disabled>
                Next
              </Button>
            ) : (
              <Button asChild variant="outline" className="min-w-[120px]">
                <Link href={buildHref(params, { page: String(data.page + 1) })}>Next</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
