import test from "node:test";
import assert from "node:assert/strict";
import { groupBatches, planConsumption } from "../lib/pantry.js";

const DAY = 86400000;
const NOW = new Date(2026, 7, 3, 12, 0, 0).getTime();

const batch = (id, base, added, over = {}) => ({
  id, name: "chicken breast", base, base_unit: "g",
  pkg_label: "1 kg", pkg_base: 1000, added, storage: "fridge", shelf_life: null, ...over,
});

test("consumption takes from the oldest batch first", () => {
  const plan = planConsumption([batch(2, 500, NOW), batch(1, 500, NOW - 3 * DAY)], 300);
  assert.equal(plan.removed, 300);
  assert.deepEqual(plan.updates, [{ id: 1, left: 200 }]);
  assert.deepEqual(plan.deletes, []);
});

test("a batch drained to zero is deleted, and the next one covers the rest", () => {
  const plan = planConsumption([batch(1, 500, NOW - 3 * DAY), batch(2, 500, NOW)], 700);
  assert.equal(plan.removed, 700);
  assert.deepEqual(plan.deletes, [1]);
  assert.deepEqual(plan.updates, [{ id: 2, left: 300 }]);
});

test("using exactly what's in a batch deletes it without touching the next", () => {
  const plan = planConsumption([batch(1, 500, NOW - DAY), batch(2, 500, NOW)], 500);
  assert.deepEqual(plan.deletes, [1]);
  assert.deepEqual(plan.updates, []);
});

test("asking for more than you have removes everything and reports the shortfall", () => {
  const plan = planConsumption([batch(1, 200, NOW), batch(2, 100, NOW + 1)], 900);
  assert.equal(plan.removed, 300, "only what was actually there");
  assert.deepEqual(plan.deletes, [1, 2]);
  assert.deepEqual(plan.updates, []);
});

test("nothing in stock removes nothing", () => {
  const plan = planConsumption([], 500);
  assert.deepEqual(plan, { removed: 0, updates: [], deletes: [] });
});

test("repeated partial removals don't drift or leave a phantom crumb", () => {
  // Thirds of 100 don't divide evenly, and every step rounds to 2dp. After
  // three of them the batch must be gone, not sitting at 0.01.
  let stock = [batch(1, 100, NOW)];
  let removed = 0;
  for (let i = 0; i < 3; i++) {
    const plan = planConsumption(stock, 33.33);
    removed = +(removed + plan.removed).toFixed(2);
    stock = stock
      .filter((b) => !plan.deletes.includes(b.id))
      .map((b) => {
        const u = plan.updates.find((x) => x.id === b.id);
        return u ? { ...b, base: u.left } : b;
      });
  }
  assert.equal(removed, 99.99);
  assert.equal(stock.length, 1);
  assert.equal(stock[0].base, 0.01, "the remainder is exact, not 0.010000000000019");
});

test("an undated legacy batch is eaten before dated stock", () => {
  // added=0 means a row migrated from the old schema. It's most likely the
  // oldest thing in there, so it should go first.
  const plan = planConsumption([batch(2, 500, NOW), batch(1, 500, 0)], 100);
  assert.deepEqual(plan.updates, [{ id: 1, left: 400 }]);
});

test("grouping sums batches of the same item under one name", () => {
  const groups = groupBatches([
    batch(1, 500, NOW - DAY),
    batch(2, 250, NOW, { name: "Chicken Breasts" }), // same item, written differently
    batch(3, 6, NOW, { name: "egg", base_unit: "count", pkg_base: 12 }),
  ], NOW);
  assert.equal(groups.length, 2);
  const chicken = groups.find((g) => g.name.toLowerCase().startsWith("chicken"));
  assert.equal(chicken.base, 750);
  assert.equal(chicken.batches.length, 2);
});

test("a group's oldest batch is the earliest dated one", () => {
  const [g] = groupBatches([batch(1, 500, NOW), batch(2, 500, NOW - 5 * DAY)], NOW);
  assert.equal(g.oldest.id, 2);
});

test("for display, a dated batch outranks an undated one", () => {
  // The opposite of consumption order, on purpose: the row shows an expiry, and
  // an undated batch has none to show.
  const [g] = groupBatches([batch(1, 500, 0), batch(2, 500, NOW - DAY)], NOW);
  assert.equal(g.oldest.id, 2);
});

test("a group surfaces the soonest expiry among its batches", () => {
  const sl = { where: "fridge", fridge: 10 };
  const [g] = groupBatches([
    batch(1, 500, NOW, { shelf_life: sl }),            // 10 days out
    batch(2, 500, NOW - 8 * DAY, { shelf_life: sl }),  // 2 days out
  ], NOW);
  assert.equal(g.expLabel.days, 2);
  assert.equal(g.expLabel.text, "2d left");
});
