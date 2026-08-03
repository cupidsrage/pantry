import test from "node:test";
import assert from "node:assert/strict";
import { weekDates, normalizeProposal, summarizePlan } from "../lib/planner.js";

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
