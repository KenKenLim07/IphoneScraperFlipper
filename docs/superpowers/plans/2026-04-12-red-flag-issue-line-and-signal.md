# Red Flag Issue-Line + Signal Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix missed red-flag cases (network signal, blur back cam, bypass, “no issue” false negative) with deterministic matching and an issue-line parser.

**Architecture:** Extend `deal_text.mjs` to add feature aliases, issue-line parsing, and scoped negative suppression for “no issue.” Export `hasIcloudRisk` from the same module to make bypass detection testable, and wire `compute_deals.mjs` to use it. Tests cover the new cases.

**Tech Stack:** Node.js (ESM), `node:test`, `node:assert/strict`

---

## File Map
- Modify: `scraper/scripts/deal_text.mjs`
- Modify: `scraper/scripts/deal_text.test.mjs`
- Modify: `scraper/scripts/compute_deals.mjs`
- Modify: `scraper/package.json`

---

### Task 1: Add Failing Tests For New Cases (TDD Red)

**Files:**
- Modify: `scraper/scripts/deal_text.test.mjs`

- [ ] **Step 1: Add tests**

Append the following tests to `scraper/scripts/deal_text.test.mjs`:

```js
import { hasIcloudRisk } from "./deal_text.mjs";

function pick(issues, keys) {
  return keys.reduce((acc, key) => {
    acc[key] = issues[key];
    return acc;
  }, {});
}

test("network signal not working is detected", () => {
  const issues = detectIssues("Network Signal is not Working, the rest are working");
  assert.deepEqual(
    pick(issues, ["network_locked"]),
    { network_locked: true }
  );
});

test("face id + truetone working despite 'no issue'", () => {
  const issues = detectIssues("TRUE TONE - FACE ID 100% WORKING NO ISSUE");
  assert.deepEqual(
    pick(issues, ["face_id_working", "trutone_working", "face_id_not_working", "trutone_missing"]),
    { face_id_working: true, trutone_working: true, face_id_not_working: false, trutone_missing: false }
  );
});

test("issue line with blurd back cam flags camera_issue", () => {
  const issues = detectIssues("ISSUE: BLURD BACK CAM");
  assert.deepEqual(
    pick(issues, ["camera_issue"]),
    { camera_issue: true }
  );
});

test("bypass phrasing triggers icloud risk", () => {
  assert.equal(hasIcloudRisk("Kamo nalang pa bypass no other issue"), true);
});

test("safe to reset does not flip face id negative", () => {
  const issues = detectIssues("safe to reset Truetone face id working");
  assert.deepEqual(
    pick(issues, ["face_id_working", "face_id_not_working", "trutone_working", "trutone_missing"]),
    { face_id_working: true, face_id_not_working: false, trutone_working: true, trutone_missing: false }
  );
});

test("wala signal is detected", () => {
  const issues = detectIssues("wala signal");
  assert.deepEqual(
    pick(issues, ["network_locked"]),
    { network_locked: true }
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /home/kenkenlim/Desktop/Projects/IphoneflipperScrapper/.worktrees/red-flag-detection-phase1
node --test scraper/scripts/deal_text.test.mjs
```
Expected: FAIL (new behavior not implemented yet or `hasIcloudRisk` not exported).

---

### Task 2: Implement Issue-Line Parser + Alias Extensions

**Files:**
- Modify: `scraper/scripts/deal_text.mjs`
- Modify: `scraper/scripts/compute_deals.mjs`

- [ ] **Step 1: Add feature aliases and issue-line parsing helpers**

In `scraper/scripts/deal_text.mjs`, add these constants near the top:

```js
const ISSUE_LINE_RE = /^\s*issue\s*[:\-]/i;

const NETWORK_ALIASES = ["network signal", "data signal", "signal", "network"];
const NETWORK_NEGATIVE_ALIASES = ["no signal", "wala signal", "walang signal"];

const CAMERA_ALIASES = ["camera", "back cam", "rear cam", "front cam", "cam"];
const CAMERA_NEGATIVE_ALIASES = ["blurd", "blurry", "blurred", "blur", "fog"];

const SCREEN_ALIASES = ["screen", "display", "lcd"];
```

Add helper functions below `buildViews`:

```js
function lineHasAny(line, needles) {
  return needles.some((n) => line.includes(n));
}

function scanIssueLines(lower) {
  const hits = { camera: false, screen: false, network: false };
  const lines = lower.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (!ISSUE_LINE_RE.test(line)) continue;
    if (lineHasAny(line, CAMERA_ALIASES)) hits.camera = true;
    if (lineHasAny(line, SCREEN_ALIASES)) hits.screen = true;
    if (lineHasAny(line, NETWORK_ALIASES)) hits.network = true;
  }
  return hits;
}
```

- [ ] **Step 2: Update FEATURE_RULES for new aliases**

Update the `network` rule to include signal aliases and negations:

```js
  network: {
    sequences: [["network", "signal"], ["data", "signal"], ["network"], ["signal"]],
    singles: ["signal", "network", "simlock", "lock", "locked"],
    collapsed: ["networksignal", "datasignal", "signal", "network"],
    positives: [],
    negatives: ["no", "not", "wala", "wla", "di", "dili", "dli", "indi", "lock", "locked", "globe", "smart", "tnt"],
    allowFallbackWorking: false
  },
```

Update `camera` rule to include back/rear/front cam and blurd:

```js
  camera: {
    sequences: [["camera"], ["back", "cam"], ["rear", "cam"], ["front", "cam"]],
    singles: ["camera", "cam"],
    collapsed: ["camera", "backcam", "rearcam", "frontcam", "cam"],
    positives: ["working", "ok", "okay", "clear", "good"],
    negatives: ["issue", "problem", "broken", "defect", "dead", "blur", "blurd", "blurry", "blurred", "fog"],
    allowFallbackWorking: false
  },
```

- [ ] **Step 3: Suppress “no issue” false negatives**

Add a helper to ignore the token `issue` when preceded by `no`:

```js
function hasNegTokenNear(tokens, positions, tokenSet, window = 3) {
  for (const pos of positions) {
    const start = Math.max(0, pos - window);
    const end = Math.min(tokens.length - 1, pos + window);
    for (let i = start; i <= end; i++) {
      const token = tokens[i];
      if (!tokenSet.has(token)) continue;
      if (token === "issue" && tokens[i - 1] === "no") continue;
      return true;
    }
  }
  return false;
}
```

Use `hasNegTokenNear(...)` in `evaluateFeature` instead of `hasTokenNear(...)` for negatives.

- [ ] **Step 4: Apply issue-line hits as explicit negatives**

In `detectIssues`, after building `views`, add:

```js
  const issueHits = scanIssueLines(views.lower);
```

Then incorporate into feature results:

```js
  const camera = evaluateFeature(views, FEATURE_RULES.camera);
  const screen = evaluateFeature(views, FEATURE_RULES.screen);
  const network = evaluateFeature(views, FEATURE_RULES.network);

  const cameraNegative = camera.negative || issueHits.camera;
  const screenNegative = screen.negative || issueHits.screen;
  const networkNegative = network.negative || issueHits.network;
```

And update the returned fields to use `cameraNegative`, `screenNegative`, `networkNegative`.

- [ ] **Step 5: Export `hasIcloudRisk` from `deal_text.mjs` and update compute_deals**

Move `hasIcloudRisk` from `compute_deals.mjs` into `deal_text.mjs` and export it:

```js
export function hasIcloudRisk(text) {
  // existing logic + new bypass and reset behavior (see next step)
}
```

Then in `compute_deals.mjs`, remove the old `hasIcloudRisk` function and update import:

```js
import { detectIssues, buildDebugReasons, hasIcloudRisk } from "./deal_text.mjs";
```

- [ ] **Step 6: Add bypass + safe reset logic to `hasIcloudRisk`**

Add these to `hasIcloudRisk`:

```js
  if (/\b(pa\s*)?bypass\b/i.test(s) || /\bbypassed\b/i.test(s)) return true;

  const resetClean =
    /\b(safe\s+to\s+reset|unli\s*reset)\b/i.test(s) &&
    /\b(icloud|activation\s*lock|lock)\b/i.test(s);
  if (resetClean) return false;
```

---

### Task 3: Verify + Commit

**Files:**
- Modify: `scraper/package.json`

- [ ] **Step 1: Add/keep test script**

Ensure `scraper/package.json` includes:

```json
"scripts": {
  "deals:test": "node --test scripts/deal_text.test.mjs"
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd /home/kenkenlim/Desktop/Projects/IphoneflipperScrapper/.worktrees/red-flag-detection-phase1
node --test scraper/scripts/deal_text.test.mjs
```
Expected: PASS (if Node is available). If Node is missing, record the failure.

- [ ] **Step 3: Commit**

```bash
git add scraper/scripts/deal_text.mjs scraper/scripts/deal_text.test.mjs scraper/scripts/compute_deals.mjs scraper/package.json
git commit -m "feat: add issue-line and signal red-flag fixes"
```

---

## Self-Review Checklist
- New tests cover all provided examples.
- “no issue” no longer flips Face ID/TrueTone negative.
- `bypass` triggers iCloud risk even without explicit `icloud`.
- Network signal phrases are captured (including `wala signal`).
- No fuzzy matching added.
