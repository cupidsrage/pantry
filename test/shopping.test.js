import test from "node:test";
import assert from "node:assert/strict";
import { planShoppingList, estimateListCost } from "../lib/shopping.js";

const ing = (name, use_base, over = {}) =>
  ({ name, use_base, base_unit: "g", pkg_label: "500 g pack", pkg_base: 500, ...over });
const stock = (name, base) => ({ id: 1, name, base, base_unit: "g" });

test("an empty week needs no shopping", () => {
  assert.deepEqual(planShoppingList([], []), []);
});

test("a fully stocked recipe adds nothing to the list", () => {
  const recipes = [{ title: "Parm", ingredients: [ing("chicken breast", 400)] }];
  assert.deepEqual(planShoppingList(recipes, [stock("chicken breast", 500)]), []);
});

test("only the shortfall is bought, rounded up to whole packages", () => {
  const recipes = [{ title: "Parm", ingredients: [ing("chicken breast", 900)] }];
  const [item] = planShoppingList(recipes, [stock("chicken breast", 400)]);
  assert.equal(item.need_base, 900);
  assert.equal(item.have_base, 400);
  assert.equal(item.short_base, 500);
  assert.equal(item.packages, 1);
});

test("a part-package shortfall still buys a whole package", () => {
  const recipes = [{ title: "Parm", ingredients: [ing("chicken breast", 550)] }];
  const [item] = planShoppingList(recipes, [stock("chicken breast", 400)]);
  assert.equal(item.short_base, 150);
  assert.equal(item.packages, 1, "you can't buy 0.3 of a pack");
});

test("stock is subtracted once for the whole week, not once per recipe", () => {
  // This is the bug adding recipes one at a time produces: 500g of chicken in
  // the pantry appears to cover both meals, and you get home 500g short.
  const recipes = [
    { title: "Monday", ingredients: [ing("chicken breast", 500)] },
    { title: "Thursday", ingredients: [ing("chicken breast", 500)] },
  ];
  const [item] = planShoppingList(recipes, [stock("chicken breast", 500)]);
  assert.equal(item.need_base, 1000, "both meals counted");
  assert.equal(item.short_base, 500, "one meal's worth still has to be bought");
  assert.equal(item.packages, 1);
});

test("the same ingredient across recipes merges into one line", () => {
  const recipes = [
    { title: "Monday", ingredients: [ing("tomatoes", 300)] },
    { title: "Friday", ingredients: [ing("tomato", 200)] }, // written singular
  ];
  const items = planShoppingList(recipes, []);
  assert.equal(items.length, 1, "plural and singular are the same item");
  assert.equal(items[0].need_base, 500);
});

test("a line records which meals wanted it", () => {
  const recipes = [
    { title: "Monday", ingredients: [ing("tomatoes", 300)] },
    { title: "Friday", ingredients: [ing("tomatoes", 200)] },
  ];
  assert.deepEqual(planShoppingList(recipes, [])[0].used_by, ["Monday", "Friday"]);
});

test("multiple pantry batches all count toward what you have", () => {
  const recipes = [{ title: "Parm", ingredients: [ing("chicken breast", 900)] }];
  const pantry = [stock("chicken breast", 400), { ...stock("chicken breast", 500), id: 2 }];
  assert.deepEqual(planShoppingList(recipes, pantry), []);
});

test("ingredients without a name or amount don't produce junk lines", () => {
  const recipes = [{ title: "Odd", ingredients: [{ name: "", use_base: 100 }, ing("salt", 0)] }];
  assert.deepEqual(planShoppingList(recipes, []), []);
});

test("the list is ordered by how much is missing", () => {
  const recipes = [{ title: "Big", ingredients: [ing("rice", 200), ing("beef", 2000), ing("peas", 600)] }];
  assert.deepEqual(planShoppingList(recipes, []).map((i) => i.name), ["beef", "peas", "rice"]);
});

test("cost is estimated from what you've paid before", () => {
  const items = [{ name: "eggs", packages: 2 }, { name: "milk", packages: 1 }];
  const purchases = [
    { name: "eggs", price: 4.0, packages: 1 },
    { name: "milk", price: 6.0, packages: 2 }, // $3.00 each
  ];
  const est = estimateListCost(items, purchases);
  assert.equal(est.total, 11, "2 x $4.00 eggs + 1 x $3.00 milk");
  assert.equal(est.priced, 2);
  assert.deepEqual(est.unknown, []);
});

test("cost uses the median price, so one bulk buy doesn't skew it", () => {
  const purchases = [
    { name: "rice", price: 4, packages: 1 },
    { name: "rice", price: 5, packages: 1 },
    { name: "rice", price: 40, packages: 1 }, // the 10kg sack
  ];
  assert.equal(estimateListCost([{ name: "rice", packages: 1 }], purchases).total, 5);
});

test("items never bought before are reported rather than guessed at", () => {
  const est = estimateListCost([{ name: "saffron", packages: 1 }], [{ name: "eggs", price: 4, packages: 1 }]);
  assert.equal(est.total, 0);
  assert.equal(est.priced, 0);
  assert.deepEqual(est.unknown, ["saffron"]);
});

test("no price history at all estimates nothing rather than crashing", () => {
  const est = estimateListCost([{ name: "eggs", packages: 1 }], []);
  assert.equal(est.total, 0);
  assert.deepEqual(est.unknown, ["eggs"]);
});
