# Discovery Seller Blocklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skip discovery listings from known spam seller IDs using a hardcoded blocklist.

**Architecture:** Add a small constant in `extract_feed.mjs` and filter out normalized listings before they are added to the discovery map. Discovery-only change.

**Tech Stack:** Node.js (ESM)

---

## File Map
- Modify: `scraper/scraper/playwright_extra/extract_feed.mjs`

---

### Task 1: Add Blocklist Filter

**Files:**
- Modify: `scraper/scraper/playwright_extra/extract_feed.mjs`

- [ ] **Step 1: Add blocklist constant**

Add near the top of the file (after imports):

```js
const DISCOVERY_SELLER_BLOCKLIST = new Set([
  "100037405695171",
  "100094736079558"
]);
```

- [ ] **Step 2: Skip blocked sellers in network listing collection**

In `collectNetworkListings`, after `candidate` is created and before adding to the map, add:

```js
const sellerId = cleanText(candidate.listing_seller_id);
if (sellerId && DISCOVERY_SELLER_BLOCKLIST.has(sellerId)) {
  continue;
}
```

- [ ] **Step 3: Skip blocked sellers in DOM extraction**

In `extractFromDom`, just before adding to `seen`, add a check using any available seller id (if present). Since DOM rows don’t include seller id, **only skip if `listing_seller_id` exists** (future-proof for when DOM extraction includes it):

```js
const sellerId = cleanText(row.listing_seller_id);
if (sellerId && DISCOVERY_SELLER_BLOCKLIST.has(sellerId)) {
  continue;
}
```

(This is a no-op today but safe for future.)

- [ ] **Step 4: Run quick sanity command**

Run:
```bash
cd /home/kenkenlim/Desktop/Projects/IphoneflipperScrapper/.worktrees/discovery-seller-blocklist
node -e "console.log('blocklist-ready')"
```
Expected: prints `blocklist-ready` (if Node is available). If Node is missing, note it.

- [ ] **Step 5: Commit**

```bash
git add scraper/scraper/playwright_extra/extract_feed.mjs
git commit -m "feat: add discovery seller blocklist"
```

---

## Self-Review Checklist
- Blocklist is discovery-only.
- Only affects listings with a matching `listing_seller_id`.
- No other behavior changes.
