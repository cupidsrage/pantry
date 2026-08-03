import test from "node:test";
import assert from "node:assert/strict";
import { UNITS, unitByKey, showBase, pkgsFromBase, norm } from "../lib/units.js";

test("every unit converts to a real base unit", () => {
  for (const u of UNITS) {
    assert.ok(["g", "ml", "count"].includes(u.base), `${u.key} has base "${u.base}"`);
    assert.ok(u.factor > 0, `${u.key} has a positive factor`);
    assert.ok(u.label, `${u.key} has a label`);
  }
  assert.equal(new Set(UNITS.map((u) => u.key)).size, UNITS.length, "unit keys are unique");
});

test("unit factors convert to base amounts", () => {
  // amount * factor = base amount, which is what every add/remove path relies on.
  assert.equal(2 * unitByKey("kg").factor, 2000);
  assert.equal(1 * unitByKey("l").factor, 1000);
  assert.equal(3 * unitByKey("tsp").factor, 14.79);
  assert.equal(unitByKey("lb").factor, 453.6);
  assert.equal(unitByKey("oz").factor, 28.35);
});

test("an unknown unit key falls back to count rather than throwing", () => {
  assert.equal(unitByKey("furlong").key, "count");
  assert.equal(unitByKey(undefined).key, "count");
});

test("showBase switches to bigger units past 1000", () => {
  assert.equal(showBase(500, "g"), "500 g");
  assert.equal(showBase(999, "g"), "999 g");
  assert.equal(showBase(1000, "g"), "1.00 kg");
  assert.equal(showBase(1500, "g"), "1.50 kg");
  assert.equal(showBase(750, "ml"), "750 ml");
  assert.equal(showBase(1500, "ml"), "1.50 L");
  assert.equal(showBase(3, "count"), "3");
  assert.equal(showBase(2.5, "count"), "2.5");
});

test("pkgsFromBase never divides by zero", () => {
  assert.equal(pkgsFromBase(1000, 500), 2);
  assert.equal(pkgsFromBase(1000, 0), 0);
  assert.equal(pkgsFromBase(1000, -1), 0);
});

test("norm matches the same item written different ways", () => {
  assert.equal(norm("  EGGS  "), norm("egg"));
  assert.equal(norm("Chicken Breast"), norm("chicken breasts"));
  assert.notEqual(norm("chicken breast"), norm("chicken thigh"));
});

test("norm handles the plurals a bare trailing-s chop gets wrong", () => {
  // A recipe calling for "tomatoes" has to find "tomato" in the pantry.
  assert.equal(norm("Tomatoes"), norm("tomato"));
  assert.equal(norm("potatoes"), norm("Potato"));
  assert.equal(norm("berries"), norm("berry"));
  assert.equal(norm("strawberries"), norm("strawberry"));
});

test("norm leaves words that merely end in -es alone", () => {
  // "cheeses" must not become "chees" — it has to keep matching "cheese".
  assert.equal(norm("cheeses"), norm("cheese"));
  assert.equal(norm("limes"), norm("lime"));
});

test("norm mangles some singular words, but matches them consistently", () => {
  // De-pluralizing by chopping a trailing "s" turns "hummus" into "hummu".
  // Harmless, because it's applied to both sides of every comparison.
  assert.equal(norm("hummus"), norm("Hummus"));
  assert.equal(norm("couscous"), norm(" Couscous "));
});

test("norm must be applied exactly once per comparison", () => {
  // It is deliberately NOT idempotent: a word ending in "ss" loses one "s" per
  // pass. Anything that normalizes an already-normalized name will mismatch.
  assert.equal(norm("cross"), "cros");
  assert.notEqual(norm(norm("cross")), norm("cross"));
});
