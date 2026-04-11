# Red Flag Detection Phase 1 Design (Deterministic)

## Summary
Upgrade `detectIssues()` in `scraper/scripts/compute_deals.mjs` to handle no-spaces/concatenation, local language tokens, and scoped negation without fuzzy matching. The system remains deterministic and precision-first, with optional debug-only observability.

## Goals
- Improve recall for concatenated and local-wording descriptions (e.g., `wayfaceid`, `bukabackglass`).
- Reduce false positives via scoped negation and strict match ordering.
- Keep behavior explainable and deterministic (no fuzzy matching in Phase 1).

## Non-Goals
- No ML/NLP models or external dependencies.
- No database schema changes.
- No persistent storage of debug metadata (debug-only logs allowed).

## Matching Rules (Priority Order)
1. **Explicit negative first** (feature-scoped). If negative is detected for a feature, it wins.
2. **Explicit positive second** (feature-scoped).
3. **Collapsed exact match** for canonical tokens (handles no-space concatenations).
4. **Fallback “all working”** phrases only if no explicit negative or positive exists for that feature.

## Normalization Views
For each listing, precompute:
- `raw`: original text
- `lower`: lowercased + normalized whitespace
- `collapsed`: lowercased with non-alphanumerics removed
- `tokens`: array of lowercased tokens split on non-alphanumerics

## Scoped Negation
Negation is localized to the feature keyword. A negative token must be within a small token window around the feature keyword.
- Default window: ±3 tokens.
- `way/waay` counts as negation only if attached to a feature token (e.g., `wayfaceid`) or within the window.

## Language Groups
**Negative / Red-flag tokens (global)**
- `no`, `not`, `wala`, `wla`, `di`, `dili`, `dli`, `indi`, `way`, `waay`
- `guba`, `bypass`, `hidden`, `screenburn`
- `nalimtan` (icloud/pass)
- `ilis`, `isli`, `repl`, `rep`, `rep orig`, `pullout`
- `buka`, `basag` (cracked)

**Positive / neutral tokens (global)**
- `working`, `work`, `ok`, `okay`, `good`, `goods`
- `gagana`, `naga gana`
- `hamis`, `hamis2`, `makinis`, `orig`, `original`
- `clean`, `fresh`, `unli`
- `working tanan`, `tanan`, `lahat`

## Feature Keywords (Expanded)
**Security**: `icloud`, `passcode`, `restriction`, `simlock`, `gpp`
**Display**: `lcd`, `screen`, `backglass`, `back_glass`, `glass`
**Biometrics**: `fingerprint`, `touchid`, `homebutton`, `home_button`
**Power**: `bh`, `battery`, `batteryhealth`, `batt`
**Network**: `openline`, `anysim`, `wifionly`

## Overmatching Protection
- Only match **known canonical tokens** in collapsed text (e.g., `faceid`, `truetone`, `backglass`).
- Avoid short substrings (no `sim`-style matches).
- Prefer exact regex/phrase checks before collapsed checks.

## “All Working” Fallback
If a description says “all working / working tanan / working lahat,” treat Face ID and TrueTone as working **only if** their explicit negative patterns were not detected.

## Observability (Debug-Only)
When `DEALS_DEBUG_LISTING_ID` matches the listing, emit a debug map of which rule fired per feature (e.g., `reason=negation+feature`, `method=token_window`). No DB writes.

## Testing Strategy (TDD)
Add tests before implementation:
- Concatenations: `notruetonefaceidworking`, `wayfaceid`
- Local language: `wala face id pero working tanan`, `bukabackglass`
- Negation scoping: `face id working no truetone`
- “All working” fallback only when no negatives
- Overmatching protection (ensure `sim` doesn’t trigger)

## Rollout
- Phase 1 only (deterministic). Fuzzy matching is deferred until real misses are observed.
- Tuning will be driven by new examples from your dataset.
