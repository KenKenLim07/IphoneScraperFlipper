import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchPublicListings } from "@/lib/data";
import { formatDateTime, formatPhp, formatRelativeAge, stripEmojiFromTitle } from "@/lib/format";
import type { PublicListing } from "@/lib/types";

function asString(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] || "" : v || "";
}

function statusBadge(status: string) {
  const s = String(status || "active").toLowerCase();
  if (s === "sold") return <Badge className="bg-amber-500 text-white">sold</Badge>;
  if (s === "unavailable") return <Badge className="bg-slate-600 text-white">unavailable</Badge>;
  return <Badge variant="secondary">active</Badge>;
}

function buildHref(params: Record<string, string>, overrides: Partial<Record<string, string>>) {
  const merged = { ...params, ...overrides };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (!v) continue;
    sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function Home({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const params = {
    query: asString(sp.query),
    min: asString(sp.min),
    max: asString(sp.max),
    status: asString(sp.status),
    page: asString(sp.page) || "1"
  };

  const page = Math.max(1, Number.parseInt(params.page || "1", 10) || 1);
  const min = params.min ? Number.parseInt(params.min, 10) : null;
  const max = params.max ? Number.parseInt(params.max, 10) : null;

  const data = await fetchPublicListings({
    query: params.query || null,
    status: params.status || null,
    min: Number.isFinite(min as number) ? (min as number) : null,
    max: Number.isFinite(max as number) ? (max as number) : null,
    page,
    pageSize: 50
  });

  const nowMs = Date.now();
  const updatedAt =
    data.items
      .map((i) => i.last_seen_at)
      .filter(Boolean)
      .map((v) => new Date(String(v)).getTime())
      .filter((ms) => Number.isFinite(ms))
      .sort((a, b) => b - a)[0] || null;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-balance text-xl font-semibold tracking-tight sm:text-2xl">Public listings</h1>
        <p className="text-xs text-muted-foreground">
          Updated at {updatedAt ? formatDateTime(new Date(updatedAt).toISOString()) : "—"}
        </p>
        <p className="text-sm text-muted-foreground">
          Browse recent iPhone listings. Details and seller link are gated behind login.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
          <CardDescription>Filter by title keywords, price range, and status.</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-5">
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground sm:text-xs" htmlFor="query">
                Keywords
              </label>
              <Input id="query" name="query" placeholder="e.g. iPhone 13 128" defaultValue={params.query} />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground sm:text-xs" htmlFor="min">
                Min (PHP)
              </label>
              <Input id="min" name="min" inputMode="numeric" placeholder="5000" defaultValue={params.min} />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground sm:text-xs" htmlFor="max">
                Max (PHP)
              </label>
              <Input id="max" name="max" inputMode="numeric" placeholder="25000" defaultValue={params.max} />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground sm:text-xs" htmlFor="status">
                Status
              </label>
              <select
                id="status"
                name="status"
                defaultValue={params.status}
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-10 sm:text-sm"
              >
                <option value="">Any</option>
                <option value="active">active</option>
                <option value="sold">sold</option>
                <option value="unavailable">unavailable</option>
              </select>
            </div>
            <div className="flex items-end gap-2 md:col-span-1">
              <Button type="submit" className="w-full">
                Apply
              </Button>
            </div>

            <input type="hidden" name="page" value="1" />

            <div className="md:col-span-12">
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-muted-foreground">
                <span>
                  Showing {data.items.length} items • page {data.page} • sorted by posted time
                </span>
                <Link className="underline underline-offset-4 hover:text-foreground" href="/">
                  Clear filters
                </Link>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Listings</CardTitle>
          <CardDescription>Click any row to view the detail page (login required).</CardDescription>
        </CardHeader>
        <CardContent>
          {data.items.length ? (
            <>
              <div className="space-y-3 sm:hidden">
                {data.items.map((row: PublicListing) => (
                  <Link
                    key={row.listing_id}
                    href={`/item/${encodeURIComponent(row.listing_id)}`}
                    className="block rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm transition-colors active:bg-muted/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium leading-snug">{stripEmojiFromTitle(row.title)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {row.location_raw || "—"}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-sm">{formatPhp(row.price_php)}</div>
                        <div className="mt-1 flex justify-end">{statusBadge(row.status)}</div>
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
                ))}
              </div>

              <div className="hidden overflow-x-auto sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead className="whitespace-nowrap">Price</TableHead>
                      <TableHead className="whitespace-nowrap">Location</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="whitespace-nowrap">Posted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((row: PublicListing) => (
                      <TableRow key={row.listing_id}>
                        <TableCell className="min-w-[320px]">
                          <Link
                          href={`/item/${encodeURIComponent(row.listing_id)}`}
                          className="font-medium hover:underline hover:underline-offset-4"
                        >
                          {stripEmojiFromTitle(row.title)}
                        </Link>
                        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                          id={row.listing_id}
                        </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono">{formatPhp(row.price_php)}</TableCell>
                        <TableCell className="whitespace-nowrap">{row.location_raw || "—"}</TableCell>
                        <TableCell>{statusBadge(row.status)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span title={formatDateTime(row.posted_at || row.first_seen_at)}>
                            {formatRelativeAge(row.posted_at || row.first_seen_at, nowMs)}
                          </span>
                          {!row.posted_at ? <span className="ml-2 text-[11px] text-muted-foreground">(est.)</span> : null}
                        </TableCell>
                      </TableRow>
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
