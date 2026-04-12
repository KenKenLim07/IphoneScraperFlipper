# Red Flag Detection: Issue-Line + Signal Fixes (Design)

## Summary
Extend the red-flag detector to catch specific missed cases using deterministic, feature-keyword–required matching. Add a minimal issue-line parser and expand network/camera/bypass/reset aliases. No fuzzy matching.

## Goals
- Catch misses like:
  - "Network Signal is not Working, the rest are working"
  - "TRUE TONE - FACE ID 100% WORKING NO ISSUE"
  - "ISSUE: BLURD BACK CAM"
  - "Kamo nalang pa bypass"
  - "safe to reset Truetone face id working"
- Require explicit feature keywords (avoid generic "no issue" false positives).
- Keep deterministic priority: explicit negative > explicit positive > fallback.

## Non-Goals
- No fuzzy matching.
- No ML/NLP.
- No database schema changes.

## Matching Rules (Priority)
1. **Explicit negative** for a feature (including issue-line hits)
2. **Explicit positive** for a feature
3. **All-working fallback** only if the feature keyword appears nearby

## Token + Alias Extensions
**Network**
- Add feature aliases: `network signal`, `signal`, `data signal`
- Add negative aliases: `no signal`, `wala signal`, `walang signal`

**Camera**
- Add feature aliases: `back cam`, `rear cam`, `front cam`
- Add negative aliases: `blurd`, `blurry`, `blurred`

**Bypass / iCloud risk**
- Add negative aliases: `bypass`, `pa bypass`, `bypassed`, `activation lock`

**Reset (iCloud clean)**
- Recognize `safe to reset` / `unli reset` only when near `icloud/activation/lock` keywords.

## Issue-Line Parser (Minimal)
Scan individual lines for prefixes like `issue:` or `issue -`. If a line includes a feature alias, treat it as an **explicit negative** for that feature:
- Camera
- Screen
- Network

## Conflict Resolution
- Issue-line detection counts as explicit negative.
- Explicit negative overrides explicit positive.
- “All working” fallback only when feature keyword present and no explicit negative.

## Testing Strategy (TDD)
Add tests for:
- `Network Signal is not Working` → network issue
- `TRUE TONE - FACE ID 100% WORKING NO ISSUE` → face id + trutone working
- `ISSUE: BLURD BACK CAM` → camera issue
- `Kamo nalang pa bypass` → bypass / icloud risk
- `safe to reset Truetone face id working` → face id + trutone working; no false negative
- `wala signal` → network issue
