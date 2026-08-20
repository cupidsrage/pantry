import test from "node:test";
import assert from "node:assert/strict";
import { weekDates, normalizeProposal, summarizePlan, cookedRecipes, batchSize, MAX_BATCH } from "../lib/planner.js";

const recipes = [
  { id: 1, title: "Chicken Parm", prep_min: 15, cook_min: 30, nutrition: { calories: 700, protein: 45 } },
  { id: 2, title: "Lentil Soup", prep_min: 10, cook_min: 40, nutrition: { calories: 400, protein: 20 } },
  { id: 3, title: "Toast", prep_min: 2, cook_min: 3, nutrition: null },
];
const WEEK = "2026-08-02"; // a Sunday
const opts = { recipes, weekStart: WEEK };

test("a week is seven consecutive days", () => {
  assert.deepEqual(weekDates(WEEK), [
    "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05",
    "2026-08-06", "2026-08-07", "2026-08-08",
  ]);
});

test("a week can run across a month boundary", () => {
  assert.deepEqual(weekDates("2026-08-30").slice(0, 3), ["2026-08-30", "2026-08-31", "2026-09-01"]);
});

test("a week can run across a year boundary", () => {
  assert.deepEqual(weekDates("2026-12-28").slice(5), ["2027-01-02", "2027-01-03"]);
});

test("an unreadable week start yields no days", () => {
  assert.deepEqual(weekDates(""), []);
  assert.deepEqual(weekDates("nonsense"), []);
});

test("a clean proposal comes through intact", () => {
  const raw = { days: [{ d: "2026-08-02", r: 1, t: "18:30", why: "uses the chicken" }] };
  const { meals, dropped } = normalizeProposal(raw, opts);
  assert.deepEqual(dropped, []);
  assert.deepEqual(meals, [{
    date: "2026-08-02", meal_time: "18:30", recipe_id: 1,
    title: "Chicken Parm", why: "uses the chicken",
    // A day says nothing about batches unless it asks to: one night, cooked.
    kind: "cook", servings: 1, cook_date: "",
  }]);
});

test("a hallucinated recipe id is dropped, not written", () => {
  const raw = { days: [{ d: "2026-08-02", r: 999 }, { d: "2026-08-03", r: 2 }] };
  const { meals, dropped } = normalizeProposal(raw, opts);
  assert.equal(meals.length, 1);
  assert.equal(meals[0].recipe_id, 2);
  assert.match(dropped[0], /doesn't exist/);
});

test("a meal outside the week is dropped", () => {
  const raw = { days: [{ d: "2026-09-15", r: 1 }, { d: "2026-08-02", r: 1 }] };
  const { meals, dropped } = normalizeProposal(raw, opts);
  assert.equal(meals.length, 1);
  assert.match(dropped[0], /not in this week/);
});

test("two meals proposed for one day keeps the first", () => {
  const raw = { days: [{ d: "2026-08-02", r: 1 }, { d: "2026-08-02", r: 2 }] };
  const { meals, dropped } = normalizeProposal(raw, opts);
  assert.equal(meals.length, 1);
  assert.equal(meals[0].recipe_id, 1);
  assert.match(dropped[0], /more than one meal/);
});

test("an invented meal time falls back to the default", () => {
  const raw = { days: [
    { d: "2026-08-02", r: 1, t: "25:99" },
    { d: "2026-08-03", r: 2, t: "" },
    { d: "2026-08-04", r: 3, t: "6pm" },
  ] };
  const { meals } = normalizeProposal(raw, opts);
  assert.deepEqual(meals.map((m) => m.meal_time), ["18:00", "18:00", "18:00"]);
});

test("a custom default time is respected", () => {
  const raw = { days: [{ d: "2026-08-02", r: 1 }] };
  const { meals } = normalizeProposal(raw, { ...opts, defaultTime: "19:30" });
  assert.equal(meals[0].meal_time, "19:30");
});

test("days left unplanned are reported", () => {
  const raw = { days: [{ d: "2026-08-02", r: 1 }, { d: "2026-08-05", r: 2 }] };
  const { empty } = normalizeProposal(raw, opts);
  assert.deepEqual(empty, ["2026-08-03", "2026-08-04", "2026-08-06", "2026-08-07", "2026-08-08"]);
});

test("garbage from the model yields an empty plan rather than throwing", () => {
  for (const raw of [null, undefined, {}, { days: null }, { days: "nope" }, { days: [null, 5] }]) {
    const out = normalizeProposal(raw, opts);
    assert.deepEqual(out.meals, []);
    assert.equal(out.empty.length, 7);
  }
});

test("meals come back in date order however they arrived", () => {
  const raw = { days: [{ d: "2026-08-06", r: 1 }, { d: "2026-08-02", r: 2 }, { d: "2026-08-04", r: 3 }] };
  const { meals } = normalizeProposal(raw, opts);
  assert.deepEqual(meals.map((m) => m.date), ["2026-08-02", "2026-08-04", "2026-08-06"]);
});

test("the alternate field spelling is accepted", () => {
  const raw = { days: [{ date: "2026-08-02", recipe_id: 1, meal_time: "17:45" }] };
  const { meals } = normalizeProposal(raw, opts);
  assert.equal(meals[0].meal_time, "17:45");
  assert.equal(meals[0].recipe_id, 1);
});

test("plan summary totals time and averages nutrition over the days that have it", () => {
  const meals = [{ recipe_id: 1 }, { recipe_id: 2 }, { recipe_id: 3 }];
  const s = summarizePlan(meals, recipes);
  assert.equal(s.meals, 3);
  assert.equal(s.minutes, 100, "45 + 50 + 5");
  assert.equal(s.withNutrition, 2, "Toast has none");
  assert.equal(s.caloriesPerDay, 550, "(700 + 400) / 2");
  assert.equal(s.proteinPerDay, 33);
});

test("a plan with no nutrition anywhere reports null rather than zero", () => {
  const s = summarizePlan([{ recipe_id: 3 }], recipes);
  assert.equal(s.caloriesPerDay, null, "null means unknown, 0 would read as a real figure");
  assert.equal(s.withNutrition, 0);
});

// ---------- leftovers ----------
//
// A leftover night is the same recipe eaten again off an earlier cook's spare
// portions. Everything here is about the ways that can be nonsense: leftovers
// of a meal that was never cooked, leftovers before the cooking, or more
// leftover nights than the pot actually held.

const LEFTOVER_WEEK = {
  recipes: [
    { id: 1, title: "Chicken Parm", prep_min: 15, cook_min: 30, nutrition: { calories: 700, protein: 45 } },
    { id: 2, title: "Lentil Soup", prep_min: 10, cook_min: 40, nutrition: { calories: 400, protein: 20 } },
  ],
  weekStart: WEEK,
};

test("a batch is a whole number of nights, capped at something sane", () => {
  assert.equal(batchSize(2), 2);
  assert.equal(batchSize("3"), 3);
  assert.equal(batchSize(2.4), 2, "you can't cook 2.4 nights of dinner");
  assert.equal(batchSize(0), 1, "a night still has to feed you once");
  assert.equal(batchSize(-5), 1);
  assert.equal(batchSize(undefined), 1);
  assert.equal(batchSize(99), MAX_BATCH, "a freezer of one curry is not a plan");
});

test("a double batch on Sunday can feed Tuesday", () => {
  const { meals, dropped } = normalizeProposal({ days: [
    { d: "2026-08-02", r: 2, b: 2, why: "big pot" },
    { d: "2026-08-04", r: 2, k: "leftover" },
  ] }, LEFTOVER_WEEK);
  assert.deepEqual(dropped, []);
  assert.equal(meals[0].kind, "cook");
  assert.equal(meals[0].servings, 2);
  assert.equal(meals[1].kind, "leftover");
  assert.equal(meals[1].cook_date, "2026-08-02", "Tuesday knows which pot it came from");
  assert.equal(meals[1].servings, 1);
});

test("leftovers of something never cooked are dropped", () => {
  const { meals, dropped } = normalizeProposal({ days: [
    { d: "2026-08-04", r: 1, k: "leftover" },
  ] }, LEFTOVER_WEEK);
  assert.equal(meals.length, 0);
  assert.match(dropped[0], /isn't cooked earlier this week/);
});

test("leftovers before the meal they come from are dropped", () => {
  // Tuesday can't eat Thursday's roast.
  const { meals, dropped } = normalizeProposal({ days: [
    { d: "2026-08-04", r: 1, k: "leftover" },
    { d: "2026-08-06", r: 1, b: 2 },
  ] }, LEFTOVER_WEEK);
  assert.deepEqual(meals.map((m) => m.date), ["2026-08-06"]);
  assert.match(dropped[0], /isn't cooked earlier this week/);
});

test("a batch of one has nothing spare, whatever order the days arrive in", () => {
  // The leftover night is listed FIRST in the raw response. Judging it in
  // arrival order would look for a cook night that hasn't been read yet.
  const { meals, dropped } = normalizeProposal({ days: [
    { d: "2026-08-05", r: 1, k: "leftover" },
    { d: "2026-08-03", r: 1 },
  ] }, LEFTOVER_WEEK);
  assert.deepEqual(meals.map((m) => m.date), ["2026-08-03"]);
  assert.match(dropped[0], /only 1 night\(s\) were cooked/);
});

test("three leftover nights off a double batch keeps two and drops one", () => {
  const { meals, dropped } = normalizeProposal({ days: [
    { d: "2026-08-02", r: 2, b: 3 },
    { d: "2026-08-03", r: 2, k: "leftover" },
    { d: "2026-08-04", r: 2, k: "leftover" },
    { d: "2026-08-05", r: 2, k: "leftover" },
  ] }, LEFTOVER_WEEK);
  assert.equal(meals.length, 3, "one cook plus the two nights it actually made");
  assert.equal(dropped.length, 1);
  assert.match(dropped[0], /only 3 night\(s\) were cooked/);
});

test("cooking the same thing again refills the spare portions", () => {
  const { meals, dropped } = normalizeProposal({ days: [
    { d: "2026-08-02", r: 2, b: 2 },
    { d: "2026-08-03", r: 2, k: "leftover" },
    { d: "2026-08-06", r: 2, b: 2 },
    { d: "2026-08-07", r: 2, k: "leftover" },
  ] }, LEFTOVER_WEEK);
  assert.deepEqual(dropped, []);
  assert.equal(meals[3].cook_date, "2026-08-06", "Friday's leftovers are Thursday's pot, not Sunday's");
});

test("shopping buys the ingredients once, multiplied by the batch", () => {
  const recipes = [{ id: 2, title: "Lentil Soup", ingredients: [
    { name: "lentils", use_base: 200 }, { name: "stock", use_base: 500 },
  ] }];
  const meals = [
    { date: "2026-08-02", recipe_id: 2, kind: "cook", servings: 2 },
    { date: "2026-08-04", recipe_id: 2, kind: "leftover", servings: 1 },
  ];
  const cooking = cookedRecipes(meals, recipes);
  assert.equal(cooking.length, 1, "the leftover night buys nothing");
  assert.equal(cooking[0].ingredients[0].use_base, 400, "double batch, double lentils");
  assert.equal(cooking[0].ingredients[1].use_base, 1000);
});

test("a week of leftovers is a week of eating but not a week of cooking", () => {
  const meals = [
    { date: "2026-08-02", recipe_id: 1, kind: "cook", servings: 2 },
    { date: "2026-08-03", recipe_id: 1, kind: "leftover", servings: 1 },
  ];
  const s = summarizePlan(meals, LEFTOVER_WEEK.recipes);
  assert.equal(s.meals, 2);
  assert.equal(s.cookNights, 1);
  assert.equal(s.leftoverNights, 1);
  assert.equal(s.minutes, 45, "one pot, cooked once — not 90 minutes");
  assert.equal(s.caloriesPerDay, 700, "you still eat on Monday");
});
