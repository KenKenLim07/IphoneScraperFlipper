import path from "node:path";

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

import { cleanText, envBool } from "./utils.mjs";

export function resolveProfileDir(baseProfileDir, browserChannel) {
  const isolateByChannel = envBool("PLAYWRIGHT_PROFILE_ISOLATE_BY_CHANNEL", true);
  const base = path.resolve(baseProfileDir);
  if (!isolateByChannel) return base;
  if (path.basename(base).toLowerCase() === browserChannel) return base;
  return path.join(base, browserChannel);
}

export async function launchPersistentContext({
  userDataDir,
  browserChannel,
  headless,
  useStealth
}) {
  if (useStealth) {
    chromium.use(StealthPlugin());
  }

  const normalized = cleanText(browserChannel) || "chromium";
  const launchChannel = normalized === "chromium" ? undefined : normalized;
  return chromium.launchPersistentContext(userDataDir, {
    headless,
    channel: launchChannel,
    viewport: { width: 1366, height: 900 },
    args: ["--disable-dev-shm-usage", "--no-sandbox"]
  });
}

