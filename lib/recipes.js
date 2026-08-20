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

// ---------- duplicates ----------
//
// The same dish gets saved twice more easily than it looks: a double tap on
// Save, the same link fetched again next week, a recipe typed in that was
// already imported months ago. These two keys decide whether a recipe about to
// be added is one that's already in the book. Both sides use them — the server
// to refuse the insert, the page to warn before you even press Save — so the
// warning and the refusal always agree.

// A title reduced to the words that name the dish: case, accents, punctuation
// and a leading article all vary between two saves of the same thing.
export function recipeKey(title) {
  return String(title || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // "sauté" -> "saute"
    .replace(/[^a-z0-9]+/g, " ")                       // punctuation is noise
    .trim()
    .replace(/^(?:the|a|an) /, "")
    .replace(/\s+/g, " ");
}

// A source URL reduced to the page it points at. Protocol, "www.", a trailing
// slash, the #jump-to-ingredients anchor and campaign params all differ between
// two visits to one recipe page, so none of them may count as a difference.
export function recipeSourceKey(url) {
  const raw = String(url || "").trim().toLowerCase();
  if (!raw) return "";
  const bare = raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/#.*$/, "");
  const [path, query = ""] = bare.split("?");
  const params = query.split("&")
    .filter((p) => p && !/^(?:utm_[a-z]+|fbclid|gclid|mc_[a-z]+|ref|source)=/.test(p))
    .sort();
  return path.replace(/\/+$/, "") + (params.length ? `?${params.join("&")}` : "");
}

// The saved recipe that `candidate` would duplicate, or null.
//
// A shared source URL is the strongest signal — the very same page, saved
// twice — and it wins even when the titles differ, because a site can rename a
// recipe between visits. Failing that, an identical title counts: two different
// dishes really called the same thing exist, which is why nothing here deletes
// anything. It only flags, and the caller offers a way through.
export function findDuplicateRecipe(saved, candidate) {
  const list = saved || [];
  const src = recipeSourceKey(candidate && candidate.source_url);
  if (src) {
    const bySource = list.find((r) => recipeSourceKey(r.source_url) === src);
    if (bySource) return bySource;
  }
  const key = recipeKey(candidate && candidate.title);
  if (!key) return null;
  return list.find((r) => recipeKey(r.title) === key) || null;
}
