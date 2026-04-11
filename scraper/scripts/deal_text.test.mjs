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
