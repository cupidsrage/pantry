import test from "node:test";
import assert from "node:assert/strict";
import {
  timedSteps, planCookAlong, mergeIngredients, cookItems, ovenTemp, ovenConflicts,
  isUnattended, SETUP_MIN, DEFAULT_STEP_MIN,
} from "../lib/cookalong.js";

const MIN = 60000;
const at = (h, m = 0) => Date.UTC(2026, 7, 4, h, m); // a fixed evening to schedule against
const mins = (a, b) => Math.round((b - a) / MIN);

// ---- step timing -------------------------------------------------------------

test("an unattended step costs a moment of your time and then cooks alone", () => {
  const [s] = timedSteps({ steps: ["Bake for 40 minutes"] });
  assert.equal(s.activeMin, SETUP_MIN);
  assert.equal(s.passiveMin, 40);
});

test("a step that needs watching costs its whole duration in hands", () => {
  const [s] = timedSteps({ steps: ["Stir constantly for 8 minutes"] });
  assert.equal(s.activeMin, 8);
  assert.equal(s.passiveMin, 0);
});

test("steps with no stated time share out what's left of the recipe's estimate", () => {
  const rows = timedSteps({
    steps: ["Chop the vegetables", "Brown the beef", "Simmer 30 minutes"],
    prep_min: 20, cook_min: 32,
  });
  // the simmer already accounts for 2 + 30, leaving 20 for the two silent steps
  assert.equal(rows[0].activeMin, 10);
  assert.equal(rows[1].activeMin, 10);
  assert.equal(rows[2].passiveMin, 30);
});

test("with no estimate at all, a silent step still gets a sane default", () => {
  const rows = timedSteps({ steps: ["Chop the onion", "Serve"] });
  assert.equal(rows[0].activeMin, DEFAULT_STEP_MIN);
  assert.equal(rows[1].activeMin, DEFAULT_STEP_MIN);
});

test("blank steps are dropped rather than scheduled", () => {
  assert.equal(timedSteps({ steps: ["Chop", "", "   ", null] }).length, 1);
});

test("unattended wording is recognised, and watching wording isn't", () => {
  assert.ok(isUnattended("Roast until tender"));
  assert.ok(isUnattended("Let the dough rise"));
  assert.equal(isUnattended("Whisk until smooth"), false);
});

// ---- the schedule ------------------------------------------------------------

const rice = {
  id: "rice", title: "Rice",
  steps: ["Rinse the rice", "Simmer covered for 18 minutes", "Fluff with a fork"],
  prep_min: 5, cook_min: 20,
};
const curry = {
  id: "curry", title: "Curry",
  steps: ["Chop the onion and garlic", "Fry the paste 4 minutes", "Simmer 25 minutes", "Stir in the cream"],
  prep_min: 15, cook_min: 30,
};

test("every dish is finished at the serve time, not one before the other", () => {
  const plan = planCookAlong({ dishes: [rice, curry], serveAt: at(19) });
  assert.equal(plan.serveAt, at(19));
  for (const d of plan.dishes) {
    // the last thing you do to a dish lands within a few minutes of eating
    assert.ok(at(19) - d.readyAt <= 5 * MIN, `${d.title} sat around for ${mins(d.readyAt, at(19))} min`);
  }
});

test("one cook, so no two active stretches ever overlap", () => {
  const plan = planCookAlong({ dishes: [rice, curry, { id: "salad", title: "Salad", steps: ["Wash the leaves", "Make the dressing", "Toss"] }], serveAt: at(19) });
  const busy = plan.events
    .filter((e) => e.activeMin > 0)
    .map((e) => [e.start, e.handsFreeAt])
    .sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < busy.length; i++)
    assert.ok(busy[i][0] >= busy[i - 1][1], `hands double-booked at ${new Date(busy[i][0]).toISOString()}`);
});

test("unattended stretches are allowed to overlap — that's the point", () => {
  const plan = planCookAlong({ dishes: [rice, curry], serveAt: at(19) });
  const simmers = plan.events.filter((e) => e.passiveMin >= 18);
  assert.equal(simmers.length, 2);
  const [a, b] = simmers;
  assert.ok(a.start < b.readyAt && b.start < a.readyAt, "both pots should be on at once");
});

test("steps of one dish stay in order", () => {
  const plan = planCookAlong({ dishes: [rice, curry], serveAt: at(19) });
  for (const dish of [rice, curry]) {
    const mine = plan.events.filter((e) => e.dishId === dish.id).sort((a, b) => a.start - b.start);
    assert.deepEqual(mine.map((e) => e.stepIndex), mine.map((_, i) => i));
    for (let i = 1; i < mine.length; i++)
      assert.ok(mine[i].start >= mine[i - 1].readyAt, "a step began before the one before it finished");
  }
});

test("food pushed early is reported as waiting, not as cooking longer", () => {
  // Two dishes whose final steps both want the cook at the same moment: one has
  // to go first, and the plan should say so out loud.
  const a = { id: "a", title: "A", steps: ["Sear the steak 10 minutes"] };
  const b = { id: "b", title: "B", steps: ["Sear the fish 10 minutes"] };
  const plan = planCookAlong({ dishes: [a, b], serveAt: at(19) });
  const early = plan.events.find((e) => e.readyAt < at(19));
  assert.ok(early, "one of them has to be cooked first");
  assert.equal(early.waitMin, mins(early.readyAt, at(19)));
  assert.equal(early.passiveMin, 0);
  assert.equal(mins(early.start, early.handsFreeAt), 10, "the sear still takes ten minutes, just earlier");
});

test("starting now tells you when dinner lands", () => {
  const plan = planCookAlong({ dishes: [rice, curry], startAt: at(17, 30) });
  assert.equal(plan.startAt, at(17, 30));
  assert.ok(plan.serveAt > plan.startAt);
  assert.equal(plan.spanMin, mins(plan.startAt, plan.serveAt));
  assert.equal(Math.min(...plan.events.map((e) => e.start)), at(17, 30));
});

test("the timeline reads in the order you'd work through it", () => {
  const plan = planCookAlong({ dishes: [rice, curry], serveAt: at(19) });
  for (let i = 1; i < plan.events.length; i++)
    assert.ok(plan.events[i].start >= plan.events[i - 1].start);
  assert.equal(plan.events.length, rice.steps.length + curry.steps.length);
  assert.equal(plan.handsOnMin, plan.events.reduce((s, e) => s + e.activeMin, 0));
});

test("one dish on its own still schedules", () => {
  const plan = planCookAlong({ dishes: [rice], serveAt: at(19) });
  assert.equal(plan.events.length, 3);
  assert.ok(plan.startAt < at(19));
});

test("nothing to cook is not an error", () => {
  const plan = planCookAlong({ dishes: [], serveAt: at(19) });
  assert.deepEqual(plan.events, []);
  assert.equal(plan.startAt, at(19));
  assert.equal(plan.spanMin, 0);
});

// ---- the oven ----------------------------------------------------------------

test("oven temperatures are read however they're written", () => {
  assert.equal(ovenTemp("Preheat the oven to 425°F").deg, 425);
  assert.equal(ovenTemp("Bake at 400 degrees for 20 minutes").deg, 400);
  assert.equal(ovenTemp("Heat the oven to 200C").label, "200°C");
  assert.equal(ovenTemp("Preheat oven to 350").label, "350°F");
  assert.equal(ovenTemp("Simmer until reduced to 200 ml"), null);
  assert.equal(ovenTemp("Chop the carrots"), null);
});

test("two dishes wanting different oven temperatures at once is flagged", () => {
  const plan = planCookAlong({
    dishes: [
      { id: 1, title: "Chicken", steps: ["Roast at 425F for 40 minutes"] },
      { id: 2, title: "Gratin", steps: ["Bake at 350F for 45 minutes"] },
    ],
    serveAt: at(19),
  });
  assert.equal(plan.conflicts.length, 1);
  const [c] = plan.conflicts;
  assert.deepEqual([c.a.temp, c.b.temp].sort(), ["350°F", "425°F"]);
  assert.ok(c.to > c.from);
});

test("the same temperature is a full oven, not a clash", () => {
  const plan = planCookAlong({
    dishes: [
      { id: 1, title: "Chicken", steps: ["Roast at 400F for 40 minutes"] },
      { id: 2, title: "Potatoes", steps: ["Bake at 400F for 45 minutes"] },
    ],
    serveAt: at(19),
  });
  assert.deepEqual(plan.conflicts, []);
});

test("oven steps that never overlap don't clash", () => {
  assert.deepEqual(ovenConflicts([
    { dishId: 1, dishTitle: "A", text: "Bake at 400F", passiveMin: 20, start: at(17), readyAt: at(17, 20) },
    { dishId: 2, dishTitle: "B", text: "Bake at 350F", passiveMin: 20, start: at(18), readyAt: at(18, 20) },
  ]), []);
});

// ---- shared prep -------------------------------------------------------------

const withIngredients = [
  { id: 1, title: "Curry", servings: 2, ingredients: [
    { name: "onion", use_qty: 1, use_unit: "count", use_base: 1, base_unit: "count" },
    { name: "chicken", use_qty: 500, use_unit: "g", use_base: 500, base_unit: "g" },
  ] },
  { id: 2, title: "Soup", servings: 1, ingredients: [
    { name: "Onions", use_qty: 2, use_unit: "count", use_base: 2, base_unit: "count" },
    { name: "stock", use_qty: 1, use_unit: "l", use_base: 1000, base_unit: "ml" },
  ] },
];

test("the same ingredient across dishes is totalled once, with servings applied", () => {
  const merged = mergeIngredients(withIngredients);
  const onion = merged.find((g) => g.name.toLowerCase().startsWith("onion"));
  assert.equal(onion.use_base, 4, "2 for the doubled curry plus 2 for the soup");
  assert.equal(onion.parts.length, 2);
  assert.deepEqual(onion.parts.map((p) => p.title).sort(), ["Curry", "Soup"]);
});

test("shared ingredients sort to the top, where they're worth prepping together", () => {
  assert.equal(mergeIngredients(withIngredients)[0].parts.length, 2);
});

test("what gets subtracted is the whole session, in one line per ingredient", () => {
  const items = cookItems(withIngredients);
  assert.equal(items.length, 3);
  assert.equal(items.find((i) => i.name.toLowerCase().startsWith("onion")).use_base, 4);
  assert.equal(items.find((i) => i.name === "chicken").use_base, 1000);
});
