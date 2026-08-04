import test from "node:test";
import assert from "node:assert/strict";
import { parseDurations, longestMinutes } from "../lib/durations.js";

test("a plain duration becomes one timer", () => {
  const [d] = parseDurations("Bake for 45 minutes");
  assert.equal(d.secs, 45 * 60);
  assert.equal(d.label, "45 min");
});

test("a range starts at the low end so the food gets checked early", () => {
  const [d] = parseDurations("Roast 45-50 minutes until golden");
  assert.equal(d.secs, 45 * 60);
  assert.equal(d.label, "45–50 min");
});

test("hours and minutes written together are one timer, not two", () => {
  const durs = parseDurations("Simmer 1 hour 30 minutes");
  assert.equal(durs.length, 1);
  assert.equal(durs[0].secs, 90 * 60);
});

test("fraction glyphs are read", () => {
  const [d] = parseDurations("Rest ½ hour before slicing");
  assert.equal(d.secs, 30 * 60);
});

test("the same duration twice in a step offers one button", () => {
  const durs = parseDurations("Fry 5 minutes, turn, then fry 5 minutes more");
  assert.equal(durs.length, 1);
});

test("nonsense durations are ignored", () => {
  assert.deepEqual(parseDurations("Chop the onion"), []);
  assert.deepEqual(parseDurations("Marinate 0 minutes"), []);
  assert.deepEqual(parseDurations("Rest 5 seconds"), [], "too short to be worth a timer");
  assert.deepEqual(parseDurations("Cure for 48 hours"), [], "beyond a cooking session");
});

test("longestMinutes reserves the longest stretch in a step, not the first", () => {
  assert.equal(longestMinutes("Toast the spices 30 seconds, then simmer 20 minutes"), 20);
  assert.equal(longestMinutes("Chop the parsley"), 0);
});
