// What's about to go off, and what you could cook to save it.
//
// The pantry already knows when things expire and the Saved tab can already
// sort by it, but both of those need you to go and look. This is the same
// arithmetic pointed the other way: it decides whether there is anything worth
// interrupting someone about, and what to say.
//
// Everything here is pure and takes `now`, so the day-boundary cases — "use
// today" at one minute past midnight — can be tested at a fixed instant.

import { norm } from "./units.js";
import { expiryLabel } from "./expiry.js";
import { recipeCoverage } from "./recipes.js";

// How far ahead to look. Three days is the point where you can still plan a
// meal around something; a week ahead is just noise.
export const NUDGE_WITHIN_DAYS = 3;

// How far back to keep mentioning expired stock. Yesterday's spinach is worth a
// word — it may still be fine, and it's the last moment to look. Last month's
// is a thing you already threw away, and a notification about it is an app you
// stop trusting.
export const NUDGE_GRACE_DAYS = 1;

// The local 'HH:MM' the daily digest fires at. Morning, so there's still time
// to do something about it — cook it tonight, or buy around it on the way home.
export const DIGEST_HOUR = "09:00";

// Pantry stock expiring within `withinDays`, soonest first.
//
// One entry per item, not per batch: two half-used bags of spinach are one
// problem, and the batch that goes first is the one that decides how urgent it
// is. Items with no expiry date at all can't be judged and never appear.
export function expiringSoon(pantry, {
  now = Date.now(),
  withinDays = NUDGE_WITHIN_DAYS,
  graceDays = NUDGE_GRACE_DAYS,
} = {}) {
  const byName = new Map();
  for (const b of (pantry || [])) {
    const label = expiryLabel(b, now);
    if (!label) continue;
    if (label.days > withinDays || label.days < -graceDays) continue;
    const key = norm(b.name);
    const seen = byName.get(key);
    // The soonest batch sets the urgency; the amounts add up across batches,
    // because "200g of spinach" is what you have to cook with, not "one of two
    // bags of it".
    if (!seen) {
      byName.set(key, {
        name: b.name,
        base: Number(b.base) || 0,
        base_unit: b.base_unit,
        days: label.days,
        text: label.text,
        tone: label.tone,
      });
      continue;
    }
    seen.base = +(seen.base + (Number(b.base) || 0)).toFixed(2);
    if (label.days < seen.days) {
      seen.days = label.days;
      seen.text = label.text;
      seen.tone = label.tone;
    }
  }
  return [...byName.values()].sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
}

// Saved recipes that would use up the expiring items, best first.
//
// Ranked by how many of them a recipe uses before how well the pantry covers
// it: a dish that rescues two aging things and needs one trip to the shop beats
// a dish that rescues one and needs nothing. Coverage still breaks the tie,
// because a suggestion you can act on tonight is worth more than one you can't.
export function rescueRecipes(expiring, recipes, pantry = [], { limit = 3 } = {}) {
  const urgent = new Set((expiring || []).map((e) => norm(e.name)));
  if (!urgent.size) return [];

  const scored = [];
  for (const r of (recipes || [])) {
    const uses = (r.ingredients || [])
      .map((i) => i.name)
      .filter((n) => urgent.has(norm(n)));
    if (!uses.length) continue;
    const { have, total } = recipeCoverage(r, pantry);
    // Deduplicate: a recipe listing "spinach" twice rescues one thing.
    const rescued = [...new Set(uses.map((n) => norm(n)))].length;
    scored.push({
      id: r.id,
      title: r.title,
      rescues: rescued,
      uses: [...new Set(uses)],
      have,
      total,
      coverage: total ? have / total : 0,
    });
  }
  scored.sort((a, b) =>
    b.rescues - a.rescues ||
    b.coverage - a.coverage ||
    String(a.title).localeCompare(String(b.title)));
  return scored.slice(0, limit);
}

// A phrase for a list of names that reads like a sentence: "spinach and
// chicken", "spinach, chicken and rice".
function andList(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// The whole nudge, or null when there is nothing worth saying.
//
// `planned` is the ingredient names an upcoming planned meal already accounts
// for. Those are dropped: the plan is the answer to "what happens to this
// chicken", and being told about it anyway is how a reminder becomes something
// you swipe away without reading.
export function expiryDigest({
  pantry = [],
  recipes = [],
  planned = [],
  now = Date.now(),
  withinDays = NUDGE_WITHIN_DAYS,
  graceDays = NUDGE_GRACE_DAYS,
} = {}) {
  const spokenFor = new Set(planned.map((n) => norm(n)));
  const items = expiringSoon(pantry, { now, withinDays, graceDays })
    .filter((it) => !spokenFor.has(norm(it.name)));
  if (!items.length) return null;

  const picks = rescueRecipes(items, recipes, pantry);
  const worst = items[0];

  // The title carries the urgency, because on a locked phone it may be all
  // that's read.
  const title = items.length === 1
    ? `${worst.name} — ${worst.text}`
    : `${items.length} things to use up`;

  const listed = items.slice(0, 4).map((it) => `${it.name} (${it.text})`);
  const more = items.length - listed.length;
  let body = listed.join(", ") + (more > 0 ? `, and ${more} more` : "");
  if (picks.length) {
    const canMake = picks.filter((p) => p.have === p.total);
    // "You could make X" is only fair if the pantry can actually make it, so an
    // incomplete one is offered as an idea rather than an instruction.
    body += canMake.length
      ? ` · you could make ${andList(canMake.slice(0, 2).map((p) => p.title))} tonight`
      : ` · ${picks[0].title} uses ${andList(picks[0].uses.slice(0, 2))}`;
  }

  return { items, recipes: picks, title, body };
}
