import process from "node:process";

const args = process.argv.slice(2);
let engine = null;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--engine") {
    engine = args[i + 1] || null;
    args.splice(i, 2);
    break;
  }
  if (arg.startsWith("--engine=")) {
    engine = arg.split("=", 2)[1] || null;
    args.splice(i, 1);
    break;
  }
}

const normalized = (engine || process.env.SNIFFER_ENGINE || "playwright-extra").toLowerCase();
const engineMap = {
  puppeteer: "./legacy/sniffer_phase1_puppeteer.mjs",
  "playwright-extra": "./sniffer_phase1_playwright_extra.mjs"
};

const target = engineMap[normalized];
if (!target) {
  console.error("[ERROR] Unknown engine. Use --engine=puppeteer|playwright-extra");
  process.exit(2);
}

await import(target);
