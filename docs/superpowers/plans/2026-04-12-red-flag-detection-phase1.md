# Red Flag Detection Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden red-flag detection to handle concatenation, local tokens, and scoped negation with deterministic rules (no fuzzy).

**Architecture:** Extract text normalization + issue detection into a small, testable module. `compute_deals.mjs` consumes the module for production runs. Tests validate key Hiligaynon/Tagalog and no-space cases. Debug metadata is emitted only when `DEALS_DEBUG_LISTING_ID` is set.

**Tech Stack:** Node.js (ESM), `node:test`, `node:assert/strict`

---

## File Map
- Create: `scraper/scripts/deal_text.mjs`
- Create: `scraper/scripts/deal_text.test.mjs`
- Modify: `scraper/scripts/compute_deals.mjs`
- Modify: `scraper/package.json`

---

### Task 1: Add Failing Tests (TDD Red)

**Files:**
- Create: `scraper/scripts/deal_text.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";

import { detectIssues } from "./deal_text.mjs";

function pick(issues, keys) {
  return keys.reduce((acc, key) => {
    acc[key] = issues[key];
    return acc;
  }, {});
}

test("detectIssues handles no-space concatenations and local tokens", () => {
  const issues = detectIssues("notruetonefaceidworking");
  assert.deepEqual(
    pick(issues, ["face_id_working", "trutone_missing"]),
    { face_id_working: true, trutone_missing: true }
  );

  const issues2 = detectIssues("wayfaceid bukabackglass");
  assert.deepEqual(
    pick(issues2, ["face_id_not_working", "back_glass_cracked"]),
    { face_id_not_working: true, back_glass_cracked: true }
  );
});

test("scoped negation does not flip other features", () => {
  const issues = detectIssues("face id working no truetone");
  assert.deepEqual(
    pick(issues, ["face_id_working", "trutone_missing"]),
    { face_id_working: true, trutone_missing: true }
  );
});

test("all working fallback only when no explicit negatives", () => {
  const issues = detectIssues("working tanan no face id");
  assert.deepEqual(
    pick(issues, ["face_id_working", "face_id_not_working"]),
    { face_id_working: null, face_id_not_working: true }
  );
});

test("overmatching protection avoids short substring matches", () => {
  const issues = detectIssues("simple sim lang ok");
  assert.equal(issues.network_locked, false);
  assert.equal(issues.wifi_only, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /home/kenkenlim/Desktop/Projects/IphoneflipperScrapper/.worktrees/red-flag-detection-phase1
node --test scraper/scripts/deal_text.test.mjs
```
Expected: FAIL (module `deal_text.mjs` not found or assertions failing).

---

### Task 2: Implement Deterministic Red-Flag Detection

**Files:**
- Create: `scraper/scripts/deal_text.mjs`
- Modify: `scraper/scripts/compute_deals.mjs`
- Modify: `scraper/package.json`

- [ ] **Step 1: Add `deal_text.mjs` with normalization + detection**

```js
const NEG_TOKENS = new Set([
  "no", "not", "wala", "wla", "di", "dili", "dli", "indi", "way", "waay",
  "guba", "bypass", "hidden", "screenburn", "nalimtan",
  "ilis", "isli", "repl", "rep", "pullout", "buka", "basag",
  "issue", "problem", "broken", "defect", "dead", "disabled", "error", "fail", "failed"
]);

const POS_TOKENS = new Set([
  "working", "work", "ok", "okay", "good", "goods", "gagana", "naga", "gana",
  "hamis", "hamis2", "makinis", "orig", "original", "clean", "fresh", "unli",
  "tanan", "lahat"
]);

const ALL_WORKING_PHRASES = [
  "all working",
  "working tanan",
  "working lahat",
  "okay lahat",
  "ok lahat",
  "all goods"
];

const FEATURE_RULES = {
  face_id: {
    sequences: [["face", "id"]],
    singles: ["faceid", "face_id"],
    collapsed: ["faceid", "face_id"],
    positives: ["with", "may", "working", "ok", "okay", "gagana"],
    negatives: ["no", "not", "wala", "wla", "di", "dili", "dli", "indi", "way", "waay", "guba", "issue", "problem", "broken", "defect", "dead", "disabled"],
    allowFallbackWorking: true
  },
  trutone: {
    sequences: [["true", "tone"]],
    singles: ["truetone", "trueton", "trutone", "trueton"],
    collapsed: ["truetone", "trueton", "trutone"],
    positives: ["working", "ok", "okay", "on", "gagana"],
    negatives: ["no", "not", "wala", "wla", "di", "dili", "dli", "indi", "way", "waay", "missing", "off", "dead", "guba"],
    allowFallbackWorking: true
  },
  camera: {
    sequences: [["camera"]],
    singles: ["camera"],
    collapsed: ["camera"],
    positives: ["working", "ok", "okay", "clear", "good"],
    negatives: ["issue", "problem", "broken", "defect", "dead", "blur", "fog"],
    allowFallbackWorking: false
  },
  screen: {
    sequences: [["screen"]],
    singles: ["screen", "display"],
    collapsed: ["screen", "display"],
    positives: [],
    negatives: ["issue", "problem", "broken", "lines", "green", "pink", "flicker", "burn", "dead", "touch", "ghost"],
    allowFallbackWorking: false
  },
  lcd: {
    sequences: [["lcd"]],
    singles: ["lcd", "oled", "display"],
    collapsed: ["lcd", "oled", "display"],
    positives: ["orig", "original"],
    negatives: ["replace", "replaced", "replacement", "palit", "pinalitan", "ilis", "isli", "pullout", "incell"],
    allowFallbackWorking: false
  },
  back_glass: {
    sequences: [["back", "glass"]],
    singles: ["backglass", "back_glass", "glass"],
    collapsed: ["backglass", "backglass", "glass"],
    positives: [],
    negatives: ["crack", "cracked", "buka", "basag", "replace", "replaced", "replacement", "palit", "pinalitan"],
    allowFallbackWorking: false
  },
  network: {
    sequences: [["network"], ["sim", "lock"], ["network", "lock"]],
    singles: ["lock", "locked", "simlock"],
    collapsed: ["networklock", "simlock"],
    positives: [],
    negatives: ["lock", "locked", "globe", "smart", "tnt"],
    allowFallbackWorking: false
  },
  wifi_only: {
    sequences: [["wifi", "only"], ["wi", "fi"]],
    singles: ["wifi", "wifionly"],
    collapsed: ["wifionly"],
    positives: [],
    negatives: ["only"],
    allowFallbackWorking: false
  },
  battery: {
    sequences: [["battery"], ["batt"]],
    singles: ["battery", "batt"],
    collapsed: ["battery", "batt"],
    positives: [],
    negatives: ["replace", "replaced", "replacement", "palit", "pinalitan", "ilis", "isli"],
    allowFallbackWorking: false
  }
};

function normalizeLower(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function buildViews(text) {
  const raw = String(text || "");
  const lower = normalizeLower(raw);
  const collapsed = lower.replace(/[^a-z0-9]+/g, "");
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  return { raw, lower, collapsed, tokens };
}

function findSequencePositions(tokens, seq) {
  const positions = [];
  if (!seq.length) return positions;
  for (let i = 0; i <= tokens.length - seq.length; i++) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) {
      if (tokens[i + j] !== seq[j]) {
        ok = false;
        break;
      }
    }
    if (ok) positions.push(i);
  }
  return positions;
}

function findFeaturePositions(tokens, rule) {
  const positions = [];
  for (const seq of rule.sequences || []) {
    positions.push(...findSequencePositions(tokens, seq));
  }
  for (let i = 0; i < tokens.length; i++) {
    if ((rule.singles || []).includes(tokens[i])) positions.push(i);
  }
  return positions;
}

function hasTokenNear(tokens, positions, tokenSet, window = 3) {
  for (const pos of positions) {
    const start = Math.max(0, pos - window);
    const end = Math.min(tokens.length - 1, pos + window);
    for (let i = start; i <= end; i++) {
      if (tokenSet.has(tokens[i])) return true;
    }
  }
  return false;
}

function collapsedHasAny(collapsed, needles) {
  return (needles || []).some((n) => n && collapsed.includes(n));
}

function collapsedHasNegationPrefix(collapsed, feature) {
  const prefixes = ["no", "not", "wala", "wla", "di", "dili", "dli", "indi", "way", "waay"];
  return prefixes.some((p) => collapsed.includes(`${p}${feature}`));
}

function collapsedHasPositiveNear(collapsed, feature, positives) {
  const maxDist = 12;
  const featIdx = collapsed.indexOf(feature);
  if (featIdx === -1) return false;
  for (const p of positives) {
    const idx = collapsed.indexOf(p);
    if (idx === -1) continue;
    if (Math.abs(idx - featIdx) <= maxDist) return true;
  }
  return false;
}

function hasAllWorkingPhrase(lower) {
  return ALL_WORKING_PHRASES.some((p) => lower.includes(p));
}

function evaluateFeature(views, rule) {
  const positions = findFeaturePositions(views.tokens, rule);
  const negSet = new Set([...(rule.negatives || [])]);
  const posSet = new Set([...(rule.positives || [])]);

  const negTokenHit = positions.length ? hasTokenNear(views.tokens, positions, negSet, 3) : false;
  const posTokenHit = positions.length ? hasTokenNear(views.tokens, positions, posSet, 3) : false;

  const collapsedNeg = (rule.collapsed || []).some((c) => collapsedHasNegationPrefix(views.collapsed, c));
  const collapsedPos = (rule.collapsed || []).some((c) => collapsedHasPositiveNear(views.collapsed, c, rule.positives || []));

  const negative = negTokenHit || collapsedNeg;
  const positive = !negative && (posTokenHit || collapsedPos);

  return { negative, positive };
}

export function detectIssues(text) {
  const views = buildViews(text);
  if (!views.raw) {
    return {
      face_id_working: null,
      face_id_not_working: false,
      trutone_working: null,
      trutone_missing: false,
      lcd_replaced: false,
      back_glass_replaced: false,
      back_glass_cracked: false,
      battery_replaced: false,
      camera_issue: false,
      screen_issue: false,
      network_locked: false,
      wifi_only: false
    };
  }

  const face = evaluateFeature(views, FEATURE_RULES.face_id);
  const truetone = evaluateFeature(views, FEATURE_RULES.trutone);
  const camera = evaluateFeature(views, FEATURE_RULES.camera);
  const screen = evaluateFeature(views, FEATURE_RULES.screen);
  const lcd = evaluateFeature(views, FEATURE_RULES.lcd);
  const back = evaluateFeature(views, FEATURE_RULES.back_glass);
  const network = evaluateFeature(views, FEATURE_RULES.network);
  const wifi = evaluateFeature(views, FEATURE_RULES.wifi_only);
  const battery = evaluateFeature(views, FEATURE_RULES.battery);

  const allWorking = hasAllWorkingPhrase(views.lower);

  const faceWorking = face.positive ? true : !face.negative && allWorking ? true : null;
  const truetoneWorking = truetone.positive ? true : !truetone.negative && allWorking ? true : null;

  return {
    face_id_working: faceWorking,
    face_id_not_working: !!face.negative,
    trutone_working: truetoneWorking,
    trutone_missing: !!truetone.negative,
    lcd_replaced: !!lcd.negative,
    back_glass_replaced: !!back.negative && views.lower.includes("replace"),
    back_glass_cracked: !!back.negative && (views.lower.includes("crack") || views.lower.includes("buka") || views.lower.includes("basag")),
    battery_replaced: !!battery.negative,
    camera_issue: !!camera.negative,
    screen_issue: !!screen.negative,
    network_locked: !!network.negative,
    wifi_only: !!wifi.negative && views.lower.includes("wifi")
  };
}

export function buildDebugReasons(text) {
  const views = buildViews(text);
  const reasons = {};
  for (const [key, rule] of Object.entries(FEATURE_RULES)) {
    const res = evaluateFeature(views, rule);
    reasons[key] = res;
  }
  return reasons;
}
```

- [ ] **Step 2: Update `compute_deals.mjs` to use the module**

```js
import { detectIssues, buildDebugReasons } from "./deal_text.mjs";
```

Remove the old `detectIssues`, `anyMatch`, and `detectLcdReplaced` implementations from `compute_deals.mjs` to avoid drift.

In the debug block inside `main()`, add:

```js
if (debugListingId && debugListingId === listingId) {
  const reasons = buildDebugReasons(text);
  console.log(`[DEBUG] issues_reasons listing_id=${listingId} ${JSON.stringify(reasons)}`);
}
```

- [ ] **Step 3: Add test script**

Update `scraper/package.json`:

```json
"scripts": {
  "deals:test": "node --test scripts/deal_text.test.mjs"
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /home/kenkenlim/Desktop/Projects/IphoneflipperScrapper/.worktrees/red-flag-detection-phase1
node --test scraper/scripts/deal_text.test.mjs
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scraper/scripts/deal_text.mjs scraper/scripts/deal_text.test.mjs scraper/scripts/compute_deals.mjs scraper/package.json
git commit -m "feat: harden red-flag detection phase 1"
```

---

## Self-Review Checklist
- All spec requirements covered (scoped negation, no-space matching, local tokens, no fuzzy).
- No placeholder text in plan.
- Test cases match spec examples.
- Debug output only when `DEALS_DEBUG_LISTING_ID` is set.
