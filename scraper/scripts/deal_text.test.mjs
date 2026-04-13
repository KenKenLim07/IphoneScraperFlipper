import test from "node:test";
import assert from "node:assert/strict";

import { detectIssues, hasIcloudRisk } from "./deal_text.mjs";

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

test("bypass slang variants trigger icloud risk", () => {
  assert.equal(hasIcloudRisk("kamo lang pabybas no other issue"), true);
  assert.equal(hasIcloudRisk("bag-o lang bypass"), true);
  assert.equal(hasIcloudRisk("kamolangpabypas"), true);
  assert.equal(hasIcloudRisk("by pass"), true);
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

test("button issues are detected from volume/power mentions", () => {
  const issues = detectIssues("volume down not working");
  assert.deepEqual(
    pick(issues, ["button_issue"]),
    { button_issue: true }
  );

  const issues2 = detectIssues("power button issue");
  assert.deepEqual(
    pick(issues2, ["button_issue"]),
    { button_issue: true }
  );

  const issues3 = detectIssues("volume");
  assert.deepEqual(
    pick(issues3, ["button_issue"]),
    { button_issue: true }
  );
});

test("button mentions marked working do not flag", () => {
  const issues = detectIssues("volume up working");
  assert.deepEqual(
    pick(issues, ["button_issue"]),
    { button_issue: false }
  );

  const issues2 = detectIssues("power button ok");
  assert.deepEqual(
    pick(issues2, ["button_issue"]),
    { button_issue: false }
  );
});

test("genuine screen replacement does not trigger screen issue", () => {
  const issues = detectIssues(
    "Honest Disclosure: The Screen (Genuine) was replaced by APPLE SERVICE CENTER with Genuine Apple Part due to single dead pixel issue"
  );
  assert.deepEqual(
    pick(issues, ["lcd_replaced", "screen_issue"]),
    { lcd_replaced: true, screen_issue: false }
  );
});

test("nachange battery flags replacement", () => {
  const issues = detectIssues("Nachange lang battery");
  assert.deepEqual(
    pick(issues, ["battery_replaced"]),
    { battery_replaced: true }
  );
});

test("truetone working overrides missing with battery replaced phrasing", () => {
  const issues = detectIssues(
    "Battery Health (Replaced) ✅ NTC Approved ✅ Openline Sim ✅ Safe To Reset ✅ Face ID & True Tone Working ✅"
  );
  assert.deepEqual(
    pick(issues, ["trutone_working", "trutone_missing", "battery_replaced"]),
    { trutone_working: true, trutone_missing: false, battery_replaced: true }
  );
});

test("issue line with face id and lcd replacement does not add screen issue", () => {
  const issues = detectIssues("Issue: face id and lcd replacement 78% bh original wala kaagi paislan");
  assert.deepEqual(
    pick(issues, ["face_id_not_working", "lcd_replaced", "screen_issue"]),
    { face_id_not_working: true, lcd_replaced: true, screen_issue: false }
  );
});

test("ultrawide blur triggers camera issue", () => {
  const issues = detectIssues("ga blurd gamay 0.5");
  assert.deepEqual(
    pick(issues, ["camera_issue"]),
    { camera_issue: true }
  );
});

test("no blur cam should not flag camera issue", () => {
  const issues = detectIssues("No blur sa cam 10/10 (both)");
  assert.deepEqual(
    pick(issues, ["camera_issue"]),
    { camera_issue: false }
  );
});

test("battery mention with lcd replacement does not flag battery replaced", () => {
  const issues = detectIssues("80 percent battery health newly replaced lcd oled");
  assert.deepEqual(
    pick(issues, ["battery_replaced", "lcd_replaced"]),
    { battery_replaced: false, lcd_replaced: true }
  );
});

test("no battery change does not flag battery replaced", () => {
  const issues = detectIssues("Battery health 78% No repair/no battery change No scratches, perfect condition");
  assert.deepEqual(
    pick(issues, ["battery_replaced"]),
    { battery_replaced: false }
  );
});

test("audio issues are detected from mic/speaker mentions", () => {
  const issues = detectIssues("no microphone");
  assert.deepEqual(
    pick(issues, ["audio_issue"]),
    { audio_issue: true }
  );

  const issues2 = detectIssues("speaker issue");
  assert.deepEqual(
    pick(issues2, ["audio_issue"]),
    { audio_issue: true }
  );
});

test("audio mentions marked working do not flag", () => {
  const issues = detectIssues("microphone working");
  assert.deepEqual(
    pick(issues, ["audio_issue"]),
    { audio_issue: false }
  );
});

test("face id checkmark counts as working", () => {
  const issues = detectIssues("FACE ID ✅");
  assert.deepEqual(
    pick(issues, ["face_id_working", "face_id_not_working"]),
    { face_id_working: true, face_id_not_working: false }
  );
});

test("face id x counts as not working", () => {
  const issues = detectIssues("FACE ID x");
  assert.deepEqual(
    pick(issues, ["face_id_working", "face_id_not_working"]),
    { face_id_working: null, face_id_not_working: true }
  );
});

test("crack lcd should flag screen issue", () => {
  const issues = detectIssues("Issue crack lcd sa upper part, wala ga affect sa performance");
  assert.deepEqual(
    pick(issues, ["screen_issue"]),
    { screen_issue: true }
  );
});

test("cracklines upper part should flag screen issue", () => {
  const issues = detectIssues("Cracklines upper Part");
  assert.deepEqual(
    pick(issues, ["screen_issue"]),
    { screen_issue: true }
  );
});

test("power brick mention should not flag button issue", () => {
  const issues = detectIssues("no power brick included only original apple braided cable");
  assert.deepEqual(
    pick(issues, ["button_issue"]),
    { button_issue: false }
  );
});

test("small crack at the back should flag back glass crack", () => {
  const issues = detectIssues("small crack at the back");
  assert.deepEqual(
    pick(issues, ["back_glass_cracked"]),
    { back_glass_cracked: true }
  );
});

test("back crack suppressed when back glass replaced", () => {
  const issues = detectIssues("small crack at the back, back glass replaced");
  assert.deepEqual(
    pick(issues, ["back_glass_cracked", "back_glass_replaced"]),
    { back_glass_cracked: false, back_glass_replaced: true }
  );
});

test("back glass replacement slang suppresses crack", () => {
  const issues = detectIssues("crack at the back bag o ilis backglass");
  assert.deepEqual(
    pick(issues, ["back_glass_cracked", "back_glass_replaced"]),
    { back_glass_cracked: false, back_glass_replaced: true }
  );

  const issues2 = detectIssues("backglass na ilis");
  assert.deepEqual(
    pick(issues2, ["back_glass_replaced"]),
    { back_glass_replaced: true }
  );
});
