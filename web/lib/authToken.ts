import { SignJWT, jwtVerify } from "jose";

import { optionalEnv, requireEnv } from "@/lib/env";

const DEFAULT_COOKIE_NAME = "iaase_auth";

export function getCookieName(): string {
  return optionalEnv("WEB_AUTH_COOKIE_NAME") || DEFAULT_COOKIE_NAME;
}

function getAuthSecretKey(): Uint8Array {
  const secret = requireEnv("WEB_AUTH_SECRET");
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(): Promise<string> {
  const key = getAuthSecretKey();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60 * 24 * 7; // 7 days
  return new SignJWT({ sub: "shared" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key);
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const key = getAuthSecretKey();
    const res = await jwtVerify(token, key, { algorithms: ["HS256"] });
    return typeof res?.payload?.sub === "string" && res.payload.sub === "shared";
  } catch {
    return false;
  }
}

