import test from "node:test";
import assert from "node:assert/strict";

import { parseStorageGb } from "./parse_storage.mjs";

test("parseStorageGb handles explicit GB", () => {
  assert.equal(parseStorageGb("iPhone 13 256gb"), 256);
  assert.equal(parseStorageGb("iPhone 13 256 GB"), 256);
  assert.equal(parseStorageGb("14500 only 256gbna nga iphone 13"), 256);
});

test("parseStorageGb handles TB", () => {
  assert.equal(parseStorageGb("iPhone 15 Pro Max 1tb"), 1024);
  assert.equal(parseStorageGb("iPhone 15 Pro Max 2 TB"), 2048);
});

test("parseStorageGb handles bare storage in iPhone context", () => {
  assert.equal(parseStorageGb("iPhone 13 128 100% BH openline"), 128);
  assert.equal(parseStorageGb("IP11 64 batt health 83%"), 64);
});

test("parseStorageGb does not confuse price or battery health", () => {
  assert.equal(parseStorageGb("Price 18000 negotiable, battery health 83%"), null);
  assert.equal(parseStorageGb("iPhone 12 100% BH all working 20500"), null);
  assert.equal(parseStorageGb("iphone warranty 128 days"), null);
});

test("parseStorageGb respects explicit unit over other mentions", () => {
  assert.equal(parseStorageGb("need bigger storage 256 but unit is 128gb on listing"), 128);
});
