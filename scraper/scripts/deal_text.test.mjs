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
