// Turning a set of planned recipes into one shopping list.

import { norm } from "./units.js";

// What a week of cooking needs that isn't already on the shelf.
//
// The subtlety worth getting right: stock has to be subtracted ONCE, after
// every recipe's needs are added up. Doing it per recipe — the way adding
// recipes to the list one at a time does — lets the same 500g of chicken cover
// Monday and Thursday, and you get home without enough.
//
// `recipes` are { title, ingredients: [{ name, use_base, pkg_base, ... }] },
// already scaled for servings. `pantry` is the raw batch list.
export function planShoppingList(recipes, pantry = []) {
  const needed = new Map();
  for (const r of recipes) {
    for (const ing of (r.ingredients || [])) {
      if (!ing || !ing.name) continue;
      const key = norm(ing.name);
      if (!needed.has(key)) {
        needed.set(key, {
          name: ing.name,
          need_base: 0,
          base_unit: ing.base_unit || "count",
          pkg_label: ing.pkg_label || "each",
          pkg_base: Number(ing.pkg_base) > 0 ? Number(ing.pkg_base) : 1,
          used_by: [],
        });
      }
      const n = needed.get(key);
      n.need_base = +(n.need_base + (Number(ing.use_base) || 0)).toFixed(2);
      if (r.title && !n.used_by.includes(r.title)) n.used_by.push(r.title);
    }
  }

  const out = [];
  for (const [key, n] of needed) {
    const have_base = pantry
      .filter((p) => norm(p.name) === key)
      .reduce((s, p) => s + (Number(p.base) || 0), 0);
    const short = +(n.need_base - have_base).toFixed(2);
    if (short <= 0) continue; // already covered by what's in the pantry
    out.push({
      ...n,
      have_base: +have_base.toFixed(2),
      short_base: short,
      // You can't buy 0.3 of a bag, so round up to whole packages.
      packages: Math.max(1, Math.ceil(short / n.pkg_base)),
    });
  }
  // Biggest shortfalls first, then alphabetical, so the list is stable.
  return out.sort((a, b) => b.short_base - a.short_base || a.name.localeCompare(b.name));
}

// Roughly what the trip will cost, using the median unit price paid for each
// item. Items never bought before contribute nothing and are reported back, so
// the estimate can be shown honestly as "at least this much".
export function estimateListCost(items, purchases = []) {
  const paid = new Map();
  for (const p of purchases) {
    const unit = Number(p.price) / Math.max(1, Number(p.packages) || 1);
    if (!(unit > 0)) continue;
    const k = norm(p.name);
    if (!paid.has(k)) paid.set(k, []);
    paid.get(k).push(unit);
  }
  let total = 0;
  const unknown = [];
  for (const it of items) {
    const seen = paid.get(norm(it.name));
    if (!seen || !seen.length) { unknown.push(it.name); continue; }
    // Median rather than mean: one bulk buy shouldn't skew the estimate.
    const sorted = [...seen].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    total += median * it.packages;
  }
  return { total: +total.toFixed(2), unknown, priced: items.length - unknown.length };
}
