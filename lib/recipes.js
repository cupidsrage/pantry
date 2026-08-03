// What a recipe needs versus what's on the shelf, and searching saved recipes.

import { norm } from "./units.js";
import { expiryLabel } from "./expiry.js";

// How many of a recipe's ingredients the pantry can cover right now.
// Batches of the same ingredient are summed before comparing.
export function recipeCoverage(recipe, pantry) {
  const ings = recipe.ingredients || [];
  let have = 0;
  for (const ing of ings) {
    const total = pantry.filter((x) => norm(x.name) === norm(ing.name))
      .reduce((s, x) => s + x.base, 0);
    if (total >= (ing.use_base || 0)) have++;
  }
  return { have, total: ings.length };
}

// Soonest expiry (in days) among pantry items this recipe uses — for the
// "Use soon" sort, so recipes that use up aging stock rank first. Infinity when
// the recipe uses nothing perishable, which sinks it to the bottom.
export function recipeSoonestExpiry(recipe, pantry, now = Date.now()) {
  let best = Infinity;
  for (const ing of (recipe.ingredients || [])) {
    for (const b of pantry.filter((x) => norm(x.name) === norm(ing.name))) {
      const lbl = expiryLabel(b, now);
      if (lbl && lbl.days < best) best = lbl.days;
    }
  }
  return best;
}

// Does a recipe match a search box? Every word typed has to turn up in the title
// or in an ingredient name, so "chicken rice" finds a recipe with both. `via`
// names the ingredients that carried the match, for a "has chicken" hint.
export function recipeMatch(recipe, query) {
  const needle = (query || "").toLowerCase().trim();
  if (!needle) return { hit: true, via: "" };
  const title = (recipe.title || "").toLowerCase();
  const ings = (recipe.ingredients || []).map((i) => (i.name || "").toLowerCase());
  const via = [];
  for (const word of needle.split(/\s+/).filter(Boolean)) {
    if (title.includes(word)) continue;
    const ing = ings.find((n) => n.includes(word));
    if (!ing) return { hit: false, via: "" };
    if (!via.includes(ing)) via.push(ing);
  }
  return { hit: true, via: via.join(", ") };
}
