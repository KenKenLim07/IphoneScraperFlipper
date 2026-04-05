import { NextResponse } from "next/server";

import { clearAuthCookieAsync } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await clearAuthCookieAsync();
  return NextResponse.redirect(new URL("/", req.url), 303);
}
