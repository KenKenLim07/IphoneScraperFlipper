import crypto from "crypto";

import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { requireEnv } from "@/lib/env";
import { getCookieName, signSessionToken, verifySessionToken } from "@/lib/authToken";

export function timingSafeEquals(a: string, b: string): boolean {
  const ah = crypto.createHash("sha256").update(String(a), "utf8").digest();
  const bh = crypto.createHash("sha256").update(String(b), "utf8").digest();
  return crypto.timingSafeEqual(ah, bh);
}

export async function isAuthedRequest(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(getCookieName())?.value || null;
  if (!token) return false;
  return verifySessionToken(token);
}

export async function isAuthedCookieStore(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(getCookieName())?.value || null;
  if (!token) return false;
  return verifySessionToken(token);
}

export async function setAuthCookie(): Promise<void> {
  const token = await signSessionToken();
  const secure = process.env.NODE_ENV === "production";
  const store = await cookies();
  store.set(getCookieName(), token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  });
}

export async function clearAuthCookieAsync(): Promise<void> {
  const secure = process.env.NODE_ENV === "production";
  const store = await cookies();
  store.set(getCookieName(), "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
}

export function requireAuthPassword(): string {
  return requireEnv("WEB_AUTH_PASSWORD");
}
