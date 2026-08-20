import test from "node:test";
import assert from "node:assert/strict";
import { expiringSoon, rescueRecipes, expiryDigest, NUDGE_WITHIN_DAYS } from "../lib/waste.js";

// A fixed instant, so "use today" means the same thing every run.
const NOW = Date.parse("2026-08-03T09:00:00Z");
const days = (n) => n * 86400000;

// shelf_life is the shape the shelf-life lookup stores: days per storage state.
const item = (name, opts = {}) => ({
  id: opts.id || 1,
  name,
  base: opts.base ?? 1,
  base_unit: opts.base_unit || "count",
  added: opts.added ?? NOW,
  storage: opts.storage || "fridge",
  shelf_life: opts.shelf_life || { fridge: opts.lasts ?? 5 },
});

// An item added `age` days ago that keeps for `lasts` days expires in the
// difference — which is the only number these tests actually care about.
const expiresIn = (name, n, extra = {}) =>
  item(name, { added: NOW - days(10), lasts: 10 + n, ...extra });

test("only stock expiring inside the window is worth mentioning", () => {
  const soon = expiringSoon([
    expiresIn("spinach", 1),
    expiresIn("yoghurt", 3),
    expiresIn("cheese", 20),
  ], { now: NOW });
  assert.deepEqual(soon.map((s) => s.name), ["spinach", "yoghurt"]);
  assert.equal(soon[0].text, "1d left");
});

test("stock with no shelf life can't be judged, so it never appears", () => {
  const soon = expiringSoon([
    { id: 1, name: "flour", base: 1000, base_unit: "g", added: NOW - days(400), shelf_life: null },
    expiresIn("milk", 0),
  ], { now: NOW });
  assert.deepEqual(soon.map((s) => s.name), ["milk"]);
});

test("just-expired stock is still worth a word, but last month's is not", () => {
  const soon = expiringSoon([
    expiresIn("cream", -1),   // yesterday
    expiresIn("mince", -30),  // long gone
  ], { now: NOW });
  assert.deepEqual(soon.map((s) => s.name), ["cream"]);
  assert.equal(soon[0].text, "expired 1d ago");
});

test("two batches of one thing are one problem, urgency from the soonest", () => {
  const soon = expiringSoon([
    expiresIn("spinach", 3, { id: 1, base: 100 }),
    expiresIn("Spinach", 1, { id: 2, base: 150 }),
  ], { now: NOW });
  assert.equal(soon.length, 1, "one line for spinach, not two");
  assert.equal(soon[0].base, 250, "the amounts add up — that's what you cook with");
  assert.equal(soon[0].days, 1, "the bag that goes first sets the urgency");
});

test("the soonest to expire is listed first", () => {
  const soon = expiringSoon([
    expiresIn("yoghurt", 3),
    expiresIn("cream", -1),
    expiresIn("spinach", 1),
  ], { now: NOW });
  assert.deepEqual(soon.map((s) => s.name), ["cream", "spinach", "yoghurt"]);
});

// ---------- what to cook with it ----------

const recipe = (id, title, names) => ({
  id, title,
  ingredients: names.map((n) => ({ name: n, use_base: 1 })),
});

test("a recipe rescuing two expiring things beats one rescuing one", () => {
  const expiring = [{ name: "spinach" }, { name: "feta" }];
  const picks = rescueRecipes(expiring, [
    recipe(1, "Spinach soup", ["spinach", "stock"]),
    recipe(2, "Spanakopita", ["spinach", "feta", "pastry"]),
    recipe(3, "Toast", ["bread"]),
  ], []);
  assert.deepEqual(picks.map((p) => p.title), ["Spanakopita", "Spinach soup"]);
  assert.equal(picks[0].rescues, 2);
});

test("between equal rescues, the one the pantry already covers wins", () => {
  const expiring = [{ name: "spinach" }];
  const pantry = [
    { name: "spinach", base: 5 },
    { name: "stock", base: 5 },
  ];
  const picks = rescueRecipes(expiring, [
    recipe(1, "Spinach pie", ["spinach", "pastry", "egg"]),
    recipe(2, "Spinach soup", ["spinach", "stock"]),
  ], pantry);
  assert.equal(picks[0].title, "Spinach soup", "nothing to buy for the soup");
  assert.equal(picks[0].have, 2);
  assert.equal(picks[0].total, 2);
});

test("recipes using nothing urgent aren't suggested", () => {
  const picks = rescueRecipes([{ name: "spinach" }], [recipe(1, "Toast", ["bread"])], []);
  assert.deepEqual(picks, []);
});

test("a recipe naming one expiring item twice has only rescued it once", () => {
  const picks = rescueRecipes([{ name: "spinach" }], [
    { id: 1, title: "Double spinach", ingredients: [{ name: "spinach" }, { name: "Spinach" }] },
  ], []);
  assert.equal(picks[0].rescues, 1);
});

// ---------- the notification itself ----------

test("nothing expiring means no notification at all", () => {
  assert.equal(expiryDigest({ pantry: [expiresIn("cheese", 30)], now: NOW }), null);
});

test("one item names it in the title, where a locked phone shows it", () => {
  const d = expiryDigest({ pantry: [expiresIn("spinach", 0)], now: NOW });
  assert.equal(d.title, "spinach — use today");
});

test("several items are counted in the title and listed in the body", () => {
  const d = expiryDigest({
    pantry: [expiresIn("spinach", 0), expiresIn("cream", 1), expiresIn("yoghurt", 2)],
    now: NOW,
  });
  assert.equal(d.title, "3 things to use up");
  assert.match(d.body, /spinach \(use today\)/);
  assert.match(d.body, /cream \(1d left\)/);
});

test("a long list is trimmed rather than overflowing the notification", () => {
  const pantry = ["a", "b", "c", "d", "e", "f"].map((n, i) => expiresIn(n, 1, { id: i + 1 }));
  const d = expiryDigest({ pantry, now: NOW });
  assert.match(d.body, /and 2 more/);
});

test("a recipe the pantry can make outright is offered as tonight's dinner", () => {
  const pantry = [expiresIn("spinach", 1, { base: 5 }), item("stock", { base: 5, lasts: 500 })];
  const d = expiryDigest({
    pantry,
    recipes: [recipe(1, "Spinach soup", ["spinach", "stock"])],
    now: NOW,
  });
  assert.match(d.body, /you could make Spinach soup tonight/);
});

test("a recipe needing a shop is an idea, not an instruction", () => {
  const d = expiryDigest({
    pantry: [expiresIn("spinach", 1)],
    recipes: [recipe(1, "Spinach pie", ["spinach", "pastry", "egg"])],
    now: NOW,
  });
  assert.match(d.body, /Spinach pie uses spinach/);
  assert.doesNotMatch(d.body, /tonight/, "you can't make it tonight — don't say you can");
});

test("food an upcoming meal already accounts for isn't nagged about", () => {
  // The chicken is Thursday's dinner. Being reminded to deal with it is being
  // reminded of a decision already made.
  const d = expiryDigest({
    pantry: [expiresIn("chicken", 2), expiresIn("spinach", 1)],
    planned: ["Chicken"],
    now: NOW,
  });
  assert.deepEqual(d.items.map((i) => i.name), ["spinach"]);
  assert.equal(d.title, "spinach — 1d left");
});

test("a plan covering everything expiring means silence", () => {
  const d = expiryDigest({
    pantry: [expiresIn("chicken", 2)],
    planned: ["chicken"],
    now: NOW,
  });
  assert.equal(d, null);
});

test("the window is three days, so tomorrow's shop can be planned around it", () => {
  assert.equal(NUDGE_WITHIN_DAYS, 3);
  const d = expiryDigest({ pantry: [expiresIn("milk", 3)], now: NOW });
  assert.ok(d, "3 days out is inside the window");
  assert.equal(expiryDigest({ pantry: [expiresIn("milk", 4)], now: NOW }), null);
});
