import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { PriceHistoryChart } from "@/components/price-history-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchPrivateListing } from "@/lib/data";
import { formatDateTime, formatPhp, formatRelativeAge, stripEmojiFromTitle } from "@/lib/format";

function statusBadge(status: string) {
  const s = String(status || "active").toLowerCase();
  if (s === "sold") return <Badge className="bg-amber-500 text-white">sold</Badge>;
  if (s === "unavailable") return <Badge className="bg-slate-600 text-white">unavailable</Badge>;
  return <Badge variant="secondary">active</Badge>;
}

export default async function ItemPage({ params }: { params: Promise<{ listing_id: string }> }) {
  const { listing_id } = await params;
  const res = await fetchPrivateListing(String(listing_id));
  if (!res) notFound();

  const { listing, versions } = res;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="font-mono text-xs text-muted-foreground">listing_id={listing.listing_id}</div>
          <h1 className="text-balance text-xl font-semibold tracking-tight sm:text-2xl">
            {stripEmojiFromTitle(listing.title)}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono">{formatPhp(listing.price_php)}</span>
            <span>•</span>
            <span>{listing.location_raw || "—"}</span>
            <span>•</span>
            {statusBadge(listing.status)}
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
          <Link className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" href="/">
            Back to list
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Description</CardTitle>
            <CardDescription>From the listing detail page (when available).</CardDescription>
          </CardHeader>
          <CardContent>
            {listing.description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{listing.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No description captured yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Metadata</CardTitle>
            <CardDescription>Last known scrape timestamps.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs sm:text-sm">
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
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Price history</CardTitle>
          <CardDescription>Last 100 snapshots (chart uses numeric PHP prices only).</CardDescription>
        </CardHeader>
        <CardContent>
          <PriceHistoryChart versions={versions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent versions</CardTitle>
          <CardDescription>Most recent snapshots first.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 sm:hidden">
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
                  <TableRow key={v.snapshot_at}>
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
        </CardContent>
      </Card>
    </div>
  );
}
