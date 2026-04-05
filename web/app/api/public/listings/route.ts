import { NextResponse } from "next/server";

import { fetchPublicListings, parsePublicQueryParams } from "@/lib/data";

export const runtime = "nodejs";
export const revalidate = 30;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = parsePublicQueryParams(url.searchParams);
    const data = await fetchPublicListings(q);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

