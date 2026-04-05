import type { NextRequest } from "next/server";

import { jwtVerify } from "jose";

import { optionalEnv, requireEnv } from "@/lib/env";

const DEFAULT_COOKIE_NAME = "iaase_auth";

function getCookieName(): string {
  return optionalEnv("WEB_AUTH_COOKIE_NAME") || DEFAULT_COOKIE_NAME;
}

function getAuthSecretKey(): Uint8Array {
  const secret = requireEnv("WEB_AUTH_SECRET");
  return new TextEncoder().encode(secret);
}

async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const key = getAuthSecretKey();
    const res = await jwtVerify(token, key, { algorithms: ["HS256"] });
    return typeof res?.payload?.sub === "string" && res.payload.sub === "shared";
  } catch {
    return false;
  }
}

export async function isAuthedMiddlewareRequest(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(getCookieName())?.value || null;
  if (!token) return false;
  return verifySessionToken(token);
}
