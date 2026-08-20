import test from "node:test";
import assert from "node:assert/strict";
import { readBackup, planRestore, describeRestore, BACKUP_VERSION } from "../lib/backup.js";

const file = (over = {}) => ({
  app: "pantry-list",
  version: BACKUP_VERSION,
  exported: Date.parse("2026-08-03T09:00:00Z"),
  recipes: [], pantry: [], list: [], meals: [], purchases: [],
  ...over,
});

test("a real backup file reads, with every section present", () => {
  const { data, error } = readBackup(file({ recipes: [{ title: "Chilli" }] }));
  assert.equal(error, undefined);
  assert.deepEqual(data.recipes, [{ title: "Chilli" }]);
  assert.deepEqual(data.pantry, [], "a section that isn't there is an empty one");
});

test("someone else's JSON is refused rather than half-imported", () => {
  assert.match(readBackup({ some: "json" }).error, /isn't a Pantry & List backup/);
  assert.match(readBackup("nonsense").error, /doesn't look like a backup/);
  assert.match(readBackup(null).error, /doesn't look like a backup/);
});

test("a file from a newer version is refused, not guessed at", () => {
  const r = readBackup(file({ version: BACKUP_VERSION + 1, recipes: [{ title: "x" }] }));
  assert.match(r.error, /newer version/);
});

test("an empty backup is refused — restoring it would say it worked", () => {
  assert.match(readBackup(file()).error, /empty/);
});

// ---------- merging into an account that isn't empty ----------

test("restoring into an empty account brings everything back", () => {
  const data = readBackup(file({
    recipes: [{ title: "Chilli" }],
    pantry: [{ name: "rice", added: 1 }],
    list: [{ name: "milk" }],
    meals: [{ date: "2026-08-03", title: "Chilli" }],
    purchases: [{ name: "rice", price: 2, bought: 5 }],
  })).data;
  const plan = planRestore(data, {});
  assert.equal(plan.add.recipes.length, 1);
  assert.equal(plan.add.pantry.length, 1);
  assert.equal(plan.add.list.length, 1);
  assert.equal(plan.add.meals.length, 1);
  assert.equal(plan.add.purchases.length, 1);
  assert.equal(plan.clear, false, "a merge never deletes");
});

test("restoring the same file twice adds nothing the second time", () => {
  const data = readBackup(file({
    recipes: [{ title: "Chilli", source_url: "https://x.test/chilli" }],
    pantry: [{ name: "rice", added: Date.parse("2026-08-01T10:00:00Z") }],
    list: [{ name: "milk" }],
    meals: [{ date: "2026-08-03", title: "Chilli" }],
    purchases: [{ name: "rice", price: 2, bought: 5 }],
  })).data;
  const first = planRestore(data, {});
  // Whatever the first restore wrote is what's in the account for the second.
  const second = planRestore(data, {
    recipes: first.add.recipes, pantry: first.add.pantry, list: first.add.list,
    meals: first.add.meals, purchases: first.add.purchases,
  });
  for (const k of ["recipes", "pantry", "list", "meals", "purchases"])
    assert.equal(second.add[k].length, 0, `${k} was restored twice`);
  assert.equal(second.skipped.recipes, 1);
});

test("a recipe re-typed by hand isn't restored a second time", () => {
  // Same dish, different punctuation, no source url — the Save button's rule.
  const data = readBackup(file({ recipes: [{ title: "Chicken Parm", source_url: "" }] })).data;
  const plan = planRestore(data, { recipes: [{ id: 7, title: "chicken parm!", source_url: "" }] });
  assert.equal(plan.add.recipes.length, 0);
  assert.equal(plan.skipped.recipes, 1);
});

test("two different recipes in the backup both land", () => {
  const data = readBackup(file({ recipes: [{ title: "Chilli" }, { title: "Lentil Soup" }] })).data;
  const plan = planRestore(data, {});
  assert.equal(plan.add.recipes.length, 2);
});

test("pantry stock isn't doubled, but a genuinely later batch is kept", () => {
  const day = 86400000;
  const monday = Date.parse("2026-08-03T09:00:00Z");
  const data = readBackup(file({ pantry: [
    { name: "flour", base: 1000, added: monday },
    { name: "flour", base: 1000, added: monday + 3 * day },
  ] })).data;
  const plan = planRestore(data, { pantry: [{ name: "Flour", base: 1000, added: monday + 3600000 }] });
  assert.equal(plan.skipped.pantry, 1, "Monday's bag is the one already on the shelf");
  assert.equal(plan.add.pantry.length, 1, "Thursday's is a different bag");
  assert.equal(plan.add.pantry[0].added, monday + 3 * day);
});

test("two tins bought on the same trip are two purchases, not one", () => {
  const data = readBackup(file({ purchases: [
    { name: "tomatoes", price: 1.2, bought: 100 },
    { name: "tomatoes", price: 1.2, bought: 101 },
  ] })).data;
  const plan = planRestore(data, { purchases: [{ name: "tomatoes", price: 1.2, bought: 100 }] });
  assert.equal(plan.skipped.purchases, 1);
  assert.equal(plan.add.purchases.length, 1);
});

test("replace throws away what's there and takes the file as the truth", () => {
  const data = readBackup(file({ recipes: [{ title: "Chilli" }] })).data;
  const plan = planRestore(data, { recipes: [{ id: 1, title: "Chilli" }] }, { mode: "replace" });
  assert.equal(plan.clear, true);
  assert.equal(plan.add.recipes.length, 1, "no duplicate check — there's nothing left to clash with");
});

test("the summary counts what will actually change", () => {
  const data = readBackup(file({
    recipes: [{ title: "Chilli" }, { title: "Soup" }],
    list: [{ name: "milk" }],
  })).data;
  const plan = planRestore(data, { recipes: [{ id: 1, title: "Chilli" }] });
  const text = describeRestore(plan);
  assert.match(text, /1 recipe\b/);
  assert.match(text, /1 list/);
  assert.match(text, /1 already here/);
});

test("a restore that would change nothing says so", () => {
  const data = readBackup(file({ recipes: [{ title: "Chilli" }] })).data;
  const plan = planRestore(data, { recipes: [{ id: 1, title: "Chilli" }] });
  assert.match(describeRestore(plan), /Nothing new/);
});
