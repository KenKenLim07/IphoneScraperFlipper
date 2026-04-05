import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isAuthedMiddlewareRequest } from "@/lib/authMiddleware";

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const needsAuth =
    pathname.startsWith("/item/") ||
    pathname.startsWith("/api/private/");

  if (!needsAuth) return NextResponse.next();

  const ok = await isAuthedMiddlewareRequest(req);
  if (ok) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", `${pathname}${search || ""}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/item/:path*", "/api/private/:path*"]
};
