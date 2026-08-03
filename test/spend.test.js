import test from "node:test";
import assert from "node:assert/strict";
import { summarizeSpend } from "../lib/spend.js";

// Purchase rows arrive newest first, the way the query returns them.
const rows = [
  { name: "eggs", price: 9.0, packages: 2, ym: "2026-08" },
  { name: "coffee", price: 10.49, packages: 1, ym: "2026-08" },
  { name: "Eggs", price: 4.29, packages: 1, ym: "2026-07" },
  { name: "steak", price: 24.5, packages: 1, ym: "2026-07" },
  { name: "eggs", price: 3.79, packages: 1, ym: "2026-06" },
  { name: "milk", price: 4.5, packages: 2, ym: "2026-06" },
  { name: "coffee", price: 11.99, packages: 1, ym: "2026-06" },
];

test("no purchases yields empty sections rather than blowing up", () => {
  assert.deepEqual(summarizeSpend([]), { months: [], top: [], changes: [] });
});

test("months total up, newest first", () => {
  const s = summarizeSpend(rows);
  assert.deepEqual(s.months.map((m) => m.ym), ["2026-08", "2026-07", "2026-06"]);
  assert.equal(s.months[0].total, 19.49);
  assert.equal(s.months[1].total, 28.79);
  assert.equal(s.months[2].total, 20.28);
  assert.equal(s.months[0].n, 2);
});

test("the window keeps only the most recent months that have purchases", () => {
  const s = summarizeSpend(rows, 2);
  assert.deepEqual(s.months.map((m) => m.ym), ["2026-08", "2026-07"]);
  assert.ok(!s.top.some((t) => t.name === "milk"), "June-only items drop out of the window");
});

test("biggest spend groups by item, biggest first", () => {
  const s = summarizeSpend(rows);
  assert.equal(s.top[0].name, "steak");
  assert.equal(s.top[0].total, 24.5);
  const eggs = s.top.find((t) => t.name.toLowerCase() === "eggs");
  assert.equal(eggs.total, 17.08, "9.00 + 4.29 + 3.79, across two spellings");
  assert.equal(eggs.n, 3);
});

test("price changes compare unit price, so buying two isn't a price hike", () => {
  const s = summarizeSpend(rows);
  const eggs = s.changes.find((c) => c.name.toLowerCase() === "eggs");
  // $9.00 for 2 is $4.50 each, against $4.29 each last time — up 5%, not up 110%.
  assert.equal(eggs.unit, 4.5);
  assert.equal(eggs.was, 4.29);
  assert.equal(eggs.pct, 5);
});

test("a price drop is reported as negative", () => {
  const s = summarizeSpend(rows);
  const coffee = s.changes.find((c) => c.name === "coffee");
  assert.equal(coffee.unit, 10.49);
  assert.equal(coffee.was, 11.99);
  assert.ok(coffee.pct < 0, `expected a drop, got ${coffee.pct}%`);
});

test("an item bought once has nothing to compare against", () => {
  const s = summarizeSpend(rows);
  assert.ok(!s.changes.some((c) => c.name === "steak"));
  assert.ok(!s.changes.some((c) => c.name === "milk"));
});

test("an unchanged price is not reported as a change", () => {
  const flat = [
    { name: "rice", price: 5, packages: 1, ym: "2026-08" },
    { name: "rice", price: 5, packages: 1, ym: "2026-07" },
  ];
  assert.deepEqual(summarizeSpend(flat).changes, []);
});

test("changes are ranked by how big the move was", () => {
  const s = summarizeSpend(rows);
  const sizes = s.changes.map((c) => Math.abs(c.pct));
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a));
});

test("price history reaches past the month window", () => {
  // Coffee was last bought in August and before that in June. With a 1-month
  // window June is out of the totals, but the comparison should still find it.
  const s = summarizeSpend(rows, 1);
  assert.deepEqual(s.months.map((m) => m.ym), ["2026-08"]);
  assert.ok(s.changes.some((c) => c.name === "coffee"));
});
