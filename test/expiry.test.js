import test from "node:test";
import assert from "node:assert/strict";
import { shelfDaysFor, expiresAt, expiryLabel } from "../lib/expiry.js";

// A fixed instant, so day-boundary maths doesn't depend on when the suite runs.
// Local noon keeps every ±hours case inside the same calendar day.
const NOON = new Date(2026, 7, 3, 12, 0, 0).getTime(); // 3 Aug 2026, local
const DAY = 86400000;

const chicken = (over) => ({
  name: "chicken breast", base: 500, base_unit: "g", added: NOON,
  storage: "fridge",
  shelf_life: { where: "fridge", pantry: null, fridge: 2, freezer: 270, thawed: 2 },
  ...over,
});

test("shelf life follows the storage state the item is actually in", () => {
  assert.equal(shelfDaysFor(chicken()), 2);
  assert.equal(shelfDaysFor(chicken({ storage: "freezer" })), 270);
  assert.equal(shelfDaysFor(chicken({ storage: "thawed" })), 2);
});

test("shelf life falls back to the item's usual home when unset", () => {
  assert.equal(shelfDaysFor(chicken({ storage: "" })), 2); // shelf_life.where = fridge
});

test("shelf life is unknown when the state has no number", () => {
  assert.equal(shelfDaysFor(chicken({ storage: "pantry" })), null); // pantry: null
  assert.equal(shelfDaysFor({ name: "x", shelf_life: null }), null);
});

test("no expiry without both a purchase date and a shelf life", () => {
  assert.equal(expiresAt(chicken({ added: 0 })), null);
  assert.equal(expiresAt(chicken({ shelf_life: null })), null);
  assert.equal(expiresAt(chicken()), NOON + 2 * DAY);
});

test("expiry counts calendar days, not elapsed hours", () => {
  // Bought at noon with 2 days of life: expires at noon on the 5th. At any
  // point on the 3rd that has to read "2d left", not "1.9d".
  const it = chicken();
  assert.equal(expiryLabel(it, NOON).days, 2);
  assert.equal(expiryLabel(it, NOON - 5 * 3600000).days, 2); // 7am same day
  assert.equal(expiryLabel(it, NOON + 11 * 3600000).days, 2); // 11pm same day
});

test("expiry label wording tracks how close it is", () => {
  const at = (days) => expiryLabel(chicken({ shelf_life: { where: "fridge", fridge: days } }), NOON);
  assert.deepEqual(at(0), { text: "use today", tone: "warn", days: 0 });
  assert.equal(at(1).text, "1d left");
  assert.equal(at(3).text, "3d left");
  assert.equal(at(3).tone, "warn");
  assert.equal(at(4).tone, "ok", "past 3 days it stops being urgent");
  assert.equal(at(14).text, "14d left");
  assert.equal(at(21).text, "~3wk left");
  assert.equal(at(90).text, "~3mo left");
});

test("expired items report how long ago", () => {
  const old = chicken({ added: NOON - 5 * DAY }); // 2-day life, bought 5 days ago
  const label = expiryLabel(old, NOON);
  assert.equal(label.text, "expired 3d ago");
  assert.equal(label.tone, "bad");
  assert.equal(label.days, -3);
});

test("an item expiring later today still reads as today", () => {
  // Bought 2 days ago at noon with 2 days of life: expires at noon today.
  // An hour before and an hour after both fall on today's date.
  const it = chicken({ added: NOON - 2 * DAY });
  assert.equal(expiryLabel(it, NOON - 3600000).text, "use today");
  assert.equal(expiryLabel(it, NOON + 3600000).text, "use today");
});
