import test from "node:test";
import assert from "node:assert/strict";
import { guessSection, sectionOf, groupBySection, SECTIONS } from "../lib/aisles.js";

const cases = {
  produce: ["bananas", "red bell pepper", "garlic", "cloves garlic", "green beans", "fresh basil", "cherry tomatoes", "strawberries"],
  meat: ["chicken breast", "ground beef", "salmon fillets", "bacon"],
  dairy: ["butter", "large eggs", "whole milk", "sour cream", "cheddar cheese"],
  bakery: ["bread", "hamburger buns", "flour tortillas"],
  pantry: ["peanut butter", "chicken broth", "rice", "coconut milk", "canned tomatoes", "olive oil", "black beans"],
  baking: ["flour", "garlic powder", "ground cinnamon", "dried basil", "kosher salt", "black pepper"],
  snacks: ["tortilla chips", "dark chocolate"],
  drinks: ["orange juice", "sparkling water"],
  frozen: ["frozen peas", "ice cream"],
  household: ["paper towels", "dish soap"],
  other: ["xyz widget", ""],
};

for (const [want, names] of Object.entries(cases)) {
  test(`${want}: ${names.filter(Boolean).join(", ") || "(blank)"}`, () => {
    for (const n of names) assert.equal(guessSection(n), want, n);
  });
}

test("a whole word isn't found inside another (pea/peanut, ice/rice, egg/eggplant)", () => {
  assert.equal(guessSection("peanuts"), "pantry");
  assert.equal(guessSection("rice"), "pantry");
  assert.equal(guessSection("eggplant"), "produce");
});

test("a section someone chose beats the guess; a bad one doesn't", () => {
  assert.equal(sectionOf({ name: "tahini", section: "baking" }), "baking");
  assert.equal(sectionOf({ name: "tahini", section: "moon" }), "pantry");
  assert.equal(sectionOf({ name: "tahini", section: "" }), "pantry");
});

test("the list groups in walking order, empty sections left out, order kept inside", () => {
  const items = [{ id: 1, name: "ice cream" }, { id: 2, name: "apples" }, { id: 3, name: "milk" }, { id: 4, name: "pears" }];
  const g = groupBySection(items);
  assert.deepEqual(g.map((x) => x.key), ["produce", "dairy", "frozen"]);
  assert.deepEqual(g[0].items.map((x) => x.id), [2, 4]);
  const order = SECTIONS.map((s) => s.key);
  assert.ok(order.indexOf("produce") < order.indexOf("frozen"));
});
