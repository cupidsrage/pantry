import test from "node:test";
import assert from "node:assert/strict";
import { recipeCoverage, recipeSoonestExpiry, recipeMatch } from "../lib/recipes.js";

const DAY = 86400000;
const NOW = new Date(2026, 7, 3, 12, 0, 0).getTime();

const parm = {
  title: "Chicken Parm",
  ingredients: [
    { name: "chicken breast", use_base: 500 },
    { name: "tomatoes", use_base: 400 },
    { name: "mozzarella", use_base: 200 },
  ],
};
const stock = (name, base, over = {}) =>
  ({ id: 1, name, base, base_unit: "g", added: NOW, storage: "fridge", shelf_life: null, ...over });

test("coverage counts ingredients the pantry can actually cover", () => {
  const pantry = [stock("chicken breast", 600), stock("tomato", 100)];
  assert.deepEqual(recipeCoverage(parm, pantry), { have: 1, total: 3 });
});

test("coverage sums multiple batches of the same ingredient", () => {
  // 300 + 250 clears the 500 the recipe wants; neither batch would alone.
  const pantry = [stock("chicken breast", 300), { ...stock("chicken breast", 250), id: 2 }];
  assert.equal(recipeCoverage(parm, pantry).have, 1);
});

test("coverage matches a plural ingredient to singular stock", () => {
  // The recipe says "tomatoes", the pantry says "tomato".
  const pantry = [stock("tomato", 500)];
  assert.equal(recipeCoverage(parm, pantry).have, 1);
});

test("an empty pantry covers nothing, and an empty recipe is not 'can make'", () => {
  assert.deepEqual(recipeCoverage(parm, []), { have: 0, total: 3 });
  assert.deepEqual(recipeCoverage({ ingredients: [] }, [stock("egg", 12)]), { have: 0, total: 0 });
});

test("a fully covered recipe reports have === total", () => {
  const pantry = [stock("chicken breast", 500), stock("tomatoes", 400), stock("mozzarella", 999)];
  const cov = recipeCoverage(parm, pantry);
  assert.equal(cov.have, cov.total);
});

test("soonest expiry finds the most urgent ingredient the recipe uses", () => {
  const sl = { where: "fridge", fridge: 10 };
  const pantry = [
    stock("chicken breast", 500, { shelf_life: sl, added: NOW - 8 * DAY }), // 2 days left
    stock("tomatoes", 400, { shelf_life: sl, added: NOW }),                 // 10 days left
  ];
  assert.equal(recipeSoonestExpiry(parm, pantry, NOW), 2);
});

test("soonest expiry ignores stock the recipe doesn't call for", () => {
  const pantry = [
    stock("chicken breast", 500, { shelf_life: { where: "fridge", fridge: 10 }, added: NOW }),
    stock("yogurt", 500, { shelf_life: { where: "fridge", fridge: 1 }, added: NOW }),
  ];
  assert.equal(recipeSoonestExpiry(parm, pantry, NOW), 10, "yogurt isn't in this recipe");
});

test("a recipe using nothing perishable sinks to the bottom", () => {
  assert.equal(recipeSoonestExpiry(parm, [stock("chicken breast", 500)], NOW), Infinity);
  assert.equal(recipeSoonestExpiry(parm, [], NOW), Infinity);
});

test("an empty search matches everything", () => {
  assert.deepEqual(recipeMatch(parm, ""), { hit: true, via: "" });
  assert.deepEqual(recipeMatch(parm, "   "), { hit: true, via: "" });
});

test("search matches on the title", () => {
  assert.equal(recipeMatch(parm, "chicken").hit, true);
  assert.equal(recipeMatch(parm, "PARM").hit, true);
  assert.equal(recipeMatch(parm, "lasagne").hit, false);
});

test("search matches on ingredients and says which one carried it", () => {
  const m = recipeMatch(parm, "mozzarella");
  assert.equal(m.hit, true);
  assert.equal(m.via, "mozzarella");
});

test("every word typed has to match something", () => {
  // "chicken" hits the title, "mozzarella" an ingredient — both needed.
  assert.equal(recipeMatch(parm, "chicken mozzarella").hit, true);
  assert.equal(recipeMatch(parm, "chicken anchovy").hit, false);
});

test("a word found in the title contributes no 'has' hint", () => {
  assert.equal(recipeMatch(parm, "chicken").via, "", "title match, not an ingredient find");
});
