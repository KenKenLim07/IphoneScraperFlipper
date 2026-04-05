import { NextResponse } from "next/server";

import { fetchPrivateListing } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ listing_id: string }> }) {
  try {
    const { listing_id: listingId } = await ctx.params;
    const res = await fetchPrivateListing(String(listingId));
    if (!res) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

