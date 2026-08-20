// Getting your data out, and getting it back in.
//
// Everything in this app lives in one SQLite file on one server. That's fine
// until the volume isn't there any more, and then a book of recipes typed in
// over two years is gone. Export writes the lot to a file you keep; restore
// reads that file back.
//
// The rules that matter are all about restoring into an account that isn't
// empty — a second phone, a half-finished re-entry, a restore run twice. That
// must not double anything, so this file decides what counts as "already
// there". It's pure, and both sides of the round trip are tested against it.

import { norm } from "./units.js";
import { findDuplicateRecipe } from "./recipes.js";

// Bump when the shape changes in a way an older file wouldn't survive. Reading
// is deliberately lenient — a missing section is an empty one — so this exists
// to refuse a file from the FUTURE, which we can't know how to read.
export const BACKUP_VERSION = 1;

export const SECTIONS = ["recipes", "pantry", "list", "meals", "purchases"];

// Is this a pantry backup at all, and one we can read?
export function readBackup(raw) {
  if (!raw || typeof raw !== "object") return { error: "That doesn't look like a backup file." };
  if (raw.app !== "pantry-list") return { error: "That file isn't a Pantry & List backup." };
  const v = Number(raw.version);
  if (!Number.isFinite(v) || v < 1) return { error: "That backup's version is missing or unreadable." };
  if (v > BACKUP_VERSION)
    return { error: `That backup was written by a newer version of the app (v${v}). Update, then restore.` };
  const data = {};
  for (const key of SECTIONS) data[key] = Array.isArray(raw[key]) ? raw[key] : [];
  if (!SECTIONS.some((k) => data[k].length)) return { error: "That backup is empty." };
  return { data, version: v, exported: Number(raw.exported) || 0 };
}

// What a restore would do, given what's already in the account.
//
// Nothing here writes: it returns the rows to insert and a count of what it
// skipped, so the caller can put the question to the user first and so the
// decisions can be tested without a database.
//
// Merge is the default and the safe one — it only ever adds. Replace is for the
// real disaster case (a wiped volume, a new server), where the file is the
// truth and whatever is in the account is debris.
export function planRestore(backup, existing = {}, { mode = "merge" } = {}) {
  const have = {
    recipes: existing.recipes || [],
    pantry: existing.pantry || [],
    list: existing.list || [],
    meals: existing.meals || [],
    purchases: existing.purchases || [],
  };
  if (mode === "replace") {
    return {
      mode,
      clear: true,
      add: { ...pickAll(backup) },
      skipped: { recipes: 0, pantry: 0, list: 0, meals: 0, purchases: 0 },
    };
  }

  const add = { recipes: [], pantry: [], list: [], meals: [], purchases: [] };
  const skipped = { recipes: 0, pantry: 0, list: 0, meals: 0, purchases: 0 };

  // Recipes use the same rule the Save button does, so restoring a file you
  // half-typed back in by hand doesn't leave you with two of everything.
  const book = [...have.recipes];
  for (const r of backup.recipes) {
    if (findDuplicateRecipe(book, r)) { skipped.recipes++; continue; }
    book.push(r);
    add.recipes.push(r);
  }

  // Pantry stock is a quantity, not an identity: restoring twice would double
  // your flour. A batch is "the same batch" when the item and the day it was
  // added both match.
  const batchKey = (p) => `${norm(p.name)}|${Math.floor((Number(p.added) || 0) / 86400000)}`;
  const seenBatches = new Set(have.pantry.map(batchKey));
  for (const p of backup.pantry) {
    const k = batchKey(p);
    if (seenBatches.has(k)) { skipped.pantry++; continue; }
    seenBatches.add(k);
    add.pantry.push(p);
  }

  // A shopping list is short and about right now — one line per item is the
  // whole point of it.
  const seenList = new Set(have.list.map((l) => norm(l.name)));
  for (const l of backup.list) {
    const k = norm(l.name);
    if (seenList.has(k)) { skipped.list++; continue; }
    seenList.add(k);
    add.list.push(l);
  }

  // A planned meal is a day plus what's eaten on it.
  const mealKey = (m) => `${m.date}|${norm(m.title)}`;
  const seenMeals = new Set(have.meals.map(mealKey));
  for (const m of backup.meals) {
    const k = mealKey(m);
    if (seenMeals.has(k)) { skipped.meals++; continue; }
    seenMeals.add(k);
    add.meals.push(m);
  }

  // Purchases are history: two identical tins bought on one trip are two rows,
  // so only an exact repeat of item, price and moment counts as the same one.
  const buyKey = (p) => `${norm(p.name)}|${Number(p.price) || 0}|${Number(p.bought) || 0}`;
  const seenBuys = new Set(have.purchases.map(buyKey));
  for (const p of backup.purchases) {
    const k = buyKey(p);
    if (seenBuys.has(k)) { skipped.purchases++; continue; }
    seenBuys.add(k);
    add.purchases.push(p);
  }

  return { mode: "merge", clear: false, add, skipped };
}

function pickAll(backup) {
  const out = {};
  for (const key of SECTIONS) out[key] = backup[key] || [];
  return out;
}

// A one-line summary of a restore, for the confirmation and the result.
export function describeRestore(plan) {
  const counts = SECTIONS
    .map((k) => [k, (plan.add[k] || []).length])
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k === "meals" ? "planned meal" : k.replace(/s$/, "")}${n === 1 ? "" : "s"}`);
  if (!counts.length) return "Nothing new to restore — it's all already here.";
  const skipped = SECTIONS.reduce((s, k) => s + (plan.skipped[k] || 0), 0);
  return counts.join(", ") + (skipped ? ` · ${skipped} already here, left alone` : "");
}
