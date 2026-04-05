import { NextResponse } from "next/server";

import { requireAuthPassword, setAuthCookie, timingSafeEquals } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") || "");
  const next = String(form.get("next") || "/");

  const expected = requireAuthPassword();
  const ok = timingSafeEquals(password, expected);
  if (!ok) {
    return NextResponse.redirect(new URL(`/login?error=1&next=${encodeURIComponent(next)}`, req.url), 303);
  }

  await setAuthCookie();
  return NextResponse.redirect(new URL(next || "/", req.url), 303);
}

