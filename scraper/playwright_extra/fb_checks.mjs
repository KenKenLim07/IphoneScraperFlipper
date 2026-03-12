import { cleanText } from "./utils.mjs";

export function looksLikeLoginOrBlock(url, bodyText) {
  const current = String(url || "").toLowerCase();
  const body = String(bodyText || "").toLowerCase();
  if (current.includes("/login") || current.includes("checkpoint")) return true;
  const markers = [
    "log in to facebook",
    "create new account",
    "you must log in",
    "your request couldn't be processed"
  ];
  return markers.some((m) => body.includes(m));
}

export function looksLikeGenericMarketplaceShell(url, metaTitle) {
  const current = String(url || "").toLowerCase();
  const title = String(metaTitle || "").toLowerCase();
  if (current.includes("/marketplace/item/")) return false;
  if (current.includes("/marketplace/") && !current.includes("/marketplace/item/")) return true;
  if (title.includes("find friends") || title.includes("browse all")) return true;
  return false;
}

export async function safePageTitle(page) {
  try {
    const t = await page.title();
    return cleanText(t) || "n/a";
  } catch {
    return "n/a";
  }
}

